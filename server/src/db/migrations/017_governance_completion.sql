-- Follow-on to 016: never edit previously applied migrations.
ALTER TABLE constitution ADD COLUMN governance_policy JSONB;
CREATE TABLE governance_initial_policy (
    club_id UUID PRIMARY KEY REFERENCES club(club_id),
    policy JSONB NOT NULL CHECK (jsonb_typeof(policy)='object'),
    effective_date DATE NOT NULL,
    recorded_by UUID NOT NULL REFERENCES user_account(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER initial_policy_immutable BEFORE UPDATE OR DELETE ON governance_initial_policy FOR EACH ROW EXECUTE FUNCTION governance_immutable();

-- Record eligibility changes made by any module, including the separately owned pipeline.
CREATE TABLE governance_member_history (
    history_id BIGSERIAL PRIMARY KEY,
    club_id UUID NOT NULL, member_id UUID NOT NULL,
    role member_role NOT NULL, standing member_standing NOT NULL,
    join_date DATE NOT NULL, exit_date DATE,
    observed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    FOREIGN KEY(club_id,member_id) REFERENCES member(club_id,member_id)
);
INSERT INTO governance_member_history(club_id,member_id,role,standing,join_date,exit_date)
 SELECT club_id,member_id,role,standing,join_date,exit_date FROM member;
CREATE INDEX governance_history_member ON governance_member_history(club_id,member_id,observed_at DESC,history_id DESC);
CREATE TRIGGER member_history_immutable BEFORE UPDATE OR DELETE ON governance_member_history FOR EACH ROW EXECUTE FUNCTION governance_immutable();
CREATE FUNCTION governance_member_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF TG_OP='INSERT' OR (NEW.role,NEW.standing,NEW.join_date,NEW.exit_date) IS DISTINCT FROM (OLD.role,OLD.standing,OLD.join_date,OLD.exit_date) THEN
        INSERT INTO governance_member_history(club_id,member_id,role,standing,join_date,exit_date)
        VALUES(NEW.club_id,NEW.member_id,NEW.role,NEW.standing,NEW.join_date,NEW.exit_date);
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER governance_member_history AFTER INSERT OR UPDATE ON member FOR EACH ROW EXECUTE FUNCTION governance_member_changed();

ALTER TABLE meeting ADD COLUMN voting_policy JSONB,
 ADD COLUMN voter_count INTEGER CHECK(voter_count>=0 AND voter_count<=attendance_count),
 ADD COLUMN eligible_voter_count INTEGER CHECK(eligible_voter_count>=voter_count AND eligible_voter_count<=eligible_count),
 ADD COLUMN electorate JSONB;
CREATE TABLE governance_proposal (
    proposal_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NOT NULL REFERENCES club(club_id),
    base_constitution_id UUID NOT NULL,
    text TEXT NOT NULL,
    changes JSONB NOT NULL CHECK(jsonb_typeof(changes)='object'),
    effective_date DATE NOT NULL,
    proposed_by UUID NOT NULL REFERENCES user_account(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE(club_id,proposal_id),
    FOREIGN KEY(club_id,base_constitution_id) REFERENCES constitution(club_id,constitution_id)
);
CREATE TRIGGER proposal_immutable BEFORE UPDATE OR DELETE ON governance_proposal FOR EACH ROW EXECUTE FUNCTION governance_immutable();
ALTER TABLE resolution ADD COLUMN proposal_id UUID, ADD COLUMN voting_rules JSONB;
ALTER TABLE resolution ADD CONSTRAINT resolution_proposal_fk FOREIGN KEY(club_id,proposal_id) REFERENCES governance_proposal(club_id,proposal_id);
CREATE UNIQUE INDEX one_carried_vote_per_proposal ON resolution(club_id,proposal_id) WHERE outcome='Carried';
CREATE INDEX governance_proposals_club ON governance_proposal(club_id,created_at DESC);

-- Freeze votes using the meeting's confirmed policy; old records remain readable
-- but cannot be applied under the earlier assumed majority.
CREATE OR REPLACE FUNCTION resolution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m meeting%ROWTYPE; p governance_proposal%ROWTYPE; r JSONB; expected_rules JSONB;
    item JSONB; voting_base INTEGER; threshold INTEGER:=0; n INTEGER; d INTEGER;
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Resolutions cannot be deleted'; END IF;
    SELECT * INTO m FROM meeting WHERE club_id=NEW.club_id AND meeting_id=NEW.meeting_id;
    IF NOT FOUND OR m.voting_policy IS NULL THEN RAISE EXCEPTION 'A meeting with confirmed voting rules is required'; END IF;
    IF TG_OP='UPDATE' THEN
        IF OLD.applied_at IS NOT NULL OR NEW.applied_at IS NULL OR NEW.applied_by IS NULL OR OLD.outcome<>'Carried'
         OR (to_jsonb(NEW)-ARRAY['applied_at','applied_by','resulting_constitution_id']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['applied_at','applied_by','resulting_constitution_id']) THEN
            RAISE EXCEPTION 'Only a carried, unapplied resolution can be given effect';
        END IF;
    END IF;
    IF NEW.votes_for+NEW.votes_against+NEW.abstentions<>m.voter_count THEN RAISE EXCEPTION 'Votes must match eligible attendees'; END IF;
    IF NEW.kind='Amendment' THEN
        SELECT * INTO p FROM governance_proposal WHERE club_id=NEW.club_id AND proposal_id=NEW.proposal_id;
        IF NOT FOUND OR p.base_constitution_id<>m.constitution_id OR NEW.payload->'changes' IS DISTINCT FROM p.changes
          OR NEW.payload->>'effectiveDate' IS DISTINCT FROM p.effective_date::text OR NEW.text IS DISTINCT FROM p.text THEN RAISE EXCEPTION 'Vote must match a pending proposal exactly'; END IF;
        SELECT jsonb_agg(jsonb_build_object('name',c->>'name','rule',c->'rule') ORDER BY ord) INTO expected_rules
        FROM jsonb_array_elements(m.voting_policy->'amendmentClasses') WITH ORDINALITY t(c,ord)
        WHERE EXISTS(SELECT 1 FROM jsonb_array_elements_text(c->'fields') f WHERE p.changes ? f);
    ELSE
        IF NEW.proposal_id IS NOT NULL THEN RAISE EXCEPTION 'Only amendments reference a proposal'; END IF;
        expected_rules:=jsonb_build_array(jsonb_build_object('name',NEW.kind,'rule',m.voting_policy->lower(NEW.kind)));
    END IF;
    IF expected_rules IS NULL OR NEW.voting_rules IS DISTINCT FROM expected_rules OR jsonb_array_length(expected_rules)=0 THEN RAISE EXCEPTION 'Voting rules must match the constitution'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(expected_rules) LOOP
        r:=item->'rule'; n:=(r->>'numerator')::integer; d:=(r->>'denominator')::integer;
        voting_base:=CASE r->>'basis' WHEN 'present' THEN m.voter_count WHEN 'eligible' THEN m.eligible_voter_count WHEN 'cast' THEN NEW.votes_for+NEW.votes_against END;
        threshold:=greatest(threshold,CASE r->>'comparison' WHEN 'moreThan' THEN floor(voting_base*n::numeric/d)::integer+1 ELSE ceil(voting_base*n::numeric/d)::integer END);
    END LOOP;
    IF NEW.required_votes<>threshold OR NEW.outcome<>(CASE WHEN NOT m.quorate THEN 'Advisory' WHEN NEW.votes_for>0 AND NEW.votes_for>=threshold THEN 'Carried' ELSE 'Rejected' END) THEN RAISE EXCEPTION 'Outcome must match quorum and the constitutional majority'; END IF;
    RETURN NEW;
END $$;

-- Preserve the former lookup for already recorded cycles without rewriting money.
-- New cycles follow REQ-33 and permanently pin their selected version.
ALTER TABLE cycle ADD COLUMN constitution_id UUID;
UPDATE cycle c SET constitution_id=(SELECT k.constitution_id FROM constitution k WHERE k.club_id=c.club_id AND k.effective_date<=c.due_date ORDER BY k.version DESC LIMIT 1);
ALTER TABLE cycle ALTER COLUMN constitution_id SET NOT NULL;
ALTER TABLE cycle ADD CONSTRAINT cycle_constitution_club_fk FOREIGN KEY(club_id,constitution_id) REFERENCES constitution(club_id,constitution_id);
CREATE FUNCTION cycle_pin_constitution() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE selected UUID;
BEGIN
 IF TG_OP='UPDATE' THEN
  IF (NEW.constitution_id,NEW.start_date,NEW.due_date) IS DISTINCT FROM (OLD.constitution_id,OLD.start_date,OLD.due_date) THEN RAISE EXCEPTION 'A recorded cycle keeps its dates and constitutional version'; END IF;
 ELSE
  SELECT constitution_id INTO selected FROM constitution WHERE club_id=NEW.club_id
   AND (effective_date<NEW.start_date OR (version=1 AND effective_date<=NEW.start_date)) ORDER BY version DESC LIMIT 1;
  IF selected IS NULL THEN RAISE EXCEPTION 'No constitution applies to this cycle commencement date'; END IF;
  IF NEW.constitution_id IS NOT NULL AND NEW.constitution_id<>selected THEN RAISE EXCEPTION 'The cycle must use the version applicable to its commencement'; END IF;
  NEW.constitution_id:=selected;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER cycle_pin_constitution BEFORE INSERT OR UPDATE ON cycle FOR EACH ROW EXECUTE FUNCTION cycle_pin_constitution();
