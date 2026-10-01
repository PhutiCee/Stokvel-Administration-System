-- REQ-32, REQ-104–109. Existing constitutions conservatively require unanimity.
ALTER TABLE constitution ADD COLUMN amendment_majority_percentage SMALLINT NOT NULL DEFAULT 100
    CHECK (amendment_majority_percentage BETWEEN 51 AND 100);
ALTER TABLE member ADD CONSTRAINT member_club_identity UNIQUE (club_id, member_id);
ALTER TABLE constitution ADD CONSTRAINT constitution_club_identity UNIQUE (club_id, constitution_id);
CREATE TABLE meeting (
    meeting_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NOT NULL REFERENCES club(club_id),
    meeting_date DATE NOT NULL, agenda TEXT NOT NULL, minutes TEXT NOT NULL,
    constitution_id UUID NOT NULL,
    eligible_count INTEGER NOT NULL CHECK (eligible_count > 0),
    attendance_count INTEGER NOT NULL CHECK (attendance_count >= 0 AND attendance_count <= eligible_count),
    required_count INTEGER NOT NULL CHECK (required_count > 0 AND required_count <= eligible_count),
    quorate BOOLEAN NOT NULL,
    recorded_by UUID NOT NULL REFERENCES user_account(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (club_id, meeting_id),
    FOREIGN KEY (club_id, constitution_id) REFERENCES constitution(club_id, constitution_id),
    CHECK (quorate = (attendance_count >= required_count))
);
CREATE TABLE meeting_attendance (
    club_id UUID NOT NULL, meeting_id UUID NOT NULL, member_id UUID NOT NULL,
    PRIMARY KEY (club_id, meeting_id, member_id),
    FOREIGN KEY (club_id, meeting_id) REFERENCES meeting(club_id, meeting_id),
    FOREIGN KEY (club_id, member_id) REFERENCES member(club_id, member_id)
);
CREATE TABLE resolution (
    resolution_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NOT NULL, meeting_id UUID NOT NULL,
    kind TEXT NOT NULL CHECK (kind IN ('General','Amendment','Expulsion')),
    text TEXT NOT NULL,
    votes_for INTEGER NOT NULL CHECK (votes_for >= 0),
    votes_against INTEGER NOT NULL CHECK (votes_against >= 0),
    abstentions INTEGER NOT NULL CHECK (abstentions >= 0),
    required_votes INTEGER NOT NULL CHECK (required_votes >= 0),
    outcome TEXT NOT NULL CHECK (outcome IN ('Advisory','Carried','Rejected')),
    payload JSONB NOT NULL DEFAULT '{}',
    recorded_by UUID NOT NULL REFERENCES user_account(user_id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    applied_by UUID REFERENCES user_account(user_id), applied_at TIMESTAMPTZ,
    resulting_constitution_id UUID,
    FOREIGN KEY (club_id, meeting_id) REFERENCES meeting(club_id, meeting_id),
    FOREIGN KEY (club_id, resulting_constitution_id) REFERENCES constitution(club_id, constitution_id),
    CHECK ((applied_by IS NULL) = (applied_at IS NULL)),
    CHECK (applied_at IS NULL OR outcome = 'Carried')
);
CREATE INDEX meeting_club_date ON meeting(club_id, meeting_date DESC);
CREATE INDEX resolution_club_meeting ON resolution(club_id, meeting_id);
CREATE FUNCTION governance_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    RAISE EXCEPTION 'Governance records are immutable; record a new meeting or resolution to correct them.';
END $$;
CREATE TRIGGER meeting_immutable BEFORE UPDATE OR DELETE ON meeting FOR EACH ROW EXECUTE FUNCTION governance_immutable();
CREATE TRIGGER attendance_immutable BEFORE UPDATE OR DELETE ON meeting_attendance FOR EACH ROW EXECUTE FUNCTION governance_immutable();
CREATE FUNCTION resolution_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE m meeting%ROWTYPE; threshold INTEGER; expected_votes INTEGER;
BEGIN
    IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Resolutions cannot be deleted'; END IF;
    IF TG_OP = 'UPDATE' THEN
        IF OLD.applied_at IS NOT NULL OR NEW.applied_at IS NULL OR NEW.applied_by IS NULL OR OLD.outcome <> 'Carried'
           OR (to_jsonb(NEW) - ARRAY['applied_at','applied_by','resulting_constitution_id']) IS DISTINCT FROM
              (to_jsonb(OLD) - ARRAY['applied_at','applied_by','resulting_constitution_id']) THEN
            RAISE EXCEPTION 'Only a carried, unapplied resolution can be given effect; its record cannot change';
        END IF;
    END IF;
    SELECT * INTO m FROM meeting WHERE club_id = NEW.club_id AND meeting_id = NEW.meeting_id;
    IF NOT FOUND OR NEW.votes_for + NEW.votes_against + NEW.abstentions <> m.attendance_count THEN RAISE EXCEPTION 'Votes must match attendance'; END IF;
    SELECT amendment_majority_percentage INTO threshold FROM constitution WHERE club_id=NEW.club_id AND constitution_id=m.constitution_id;
    expected_votes := CASE WHEN NEW.kind='Amendment' THEN ceil(m.attendance_count * threshold / 100.0)::integer ELSE (m.attendance_count / 2) + 1 END;
    IF NEW.required_votes <> expected_votes THEN RAISE EXCEPTION 'Vote threshold must match the recorded constitution'; END IF;
    IF (NOT m.quorate AND NEW.outcome <> 'Advisory') OR
       (m.quorate AND NEW.outcome <> CASE WHEN NEW.votes_for > 0 AND NEW.votes_for >= NEW.required_votes THEN 'Carried' ELSE 'Rejected' END) THEN
       RAISE EXCEPTION 'Resolution outcome does not match quorum and votes';
    END IF;
    RETURN NEW;
END $$;
CREATE TRIGGER resolution_guard BEFORE INSERT OR UPDATE OR DELETE ON resolution FOR EACH ROW EXECUTE FUNCTION resolution_guard();
