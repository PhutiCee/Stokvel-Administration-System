-- REQ-36, REQ-45–49, REQ-129–135. Existing migrations stay unchanged.
CREATE TABLE announcement (
 announcement_id UUID PRIMARY KEY DEFAULT gen_random_uuid(), club_id UUID NOT NULL REFERENCES club(club_id),
 author_id UUID NOT NULL REFERENCES user_account(user_id), published_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 subject TEXT NOT NULL CHECK(length(btrim(subject)) BETWEEN 1 AND 160),
 body TEXT NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 10000),
 corrects_id UUID, UNIQUE(club_id,announcement_id),
 FOREIGN KEY(club_id,corrects_id) REFERENCES announcement(club_id,announcement_id)
);
CREATE INDEX announcement_feed ON announcement(club_id,published_at DESC,announcement_id DESC);
CREATE FUNCTION completion_immutable() RETURNS TRIGGER AS $$ BEGIN
 RAISE EXCEPTION '% records cannot be changed or deleted.',TG_TABLE_NAME USING ERRCODE='23001';
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER announcement_immutable BEFORE UPDATE OR DELETE ON announcement FOR EACH ROW EXECUTE FUNCTION completion_immutable();

CREATE TABLE exit_rule_mapping (
 mapping_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),club_id UUID NOT NULL REFERENCES club(club_id),
 constitution_id UUID NOT NULL REFERENCES constitution(constitution_id),
 source TEXT NOT NULL, policy JSONB NOT NULL,recorded_by UUID NOT NULL REFERENCES user_account(user_id),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(), UNIQUE(club_id,constitution_id)
);
CREATE TRIGGER exit_mapping_immutable BEFORE UPDATE OR DELETE ON exit_rule_mapping FOR EACH ROW EXECUTE FUNCTION completion_immutable();
CREATE TABLE exit_notice (
 notice_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),club_id UUID NOT NULL REFERENCES club(club_id),
 member_id UUID NOT NULL REFERENCES member(member_id),notice_date DATE NOT NULL,
 earliest_exit DATE NOT NULL CHECK(earliest_exit>=notice_date),mapping_id UUID NOT NULL REFERENCES exit_rule_mapping(mapping_id),
 requested_by UUID NOT NULL REFERENCES user_account(user_id),created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 status TEXT NOT NULL DEFAULT 'Pending' CHECK(status IN ('Pending','Approved','Cancelled')),
 decided_by UUID REFERENCES user_account(user_id),decided_at TIMESTAMPTZ,decision_reason TEXT,
 repayment_entry_id UUID REFERENCES ledger_entry(entry_id),forfeiture_entry_id UUID REFERENCES ledger_entry(entry_id),
 payout_id UUID REFERENCES payout(payout_id), assessment_id UUID,
 CHECK((status='Pending' AND decided_by IS NULL AND decided_at IS NULL) OR
       (status<>'Pending' AND decided_by IS NOT NULL AND decided_at IS NOT NULL))
);
CREATE UNIQUE INDEX exit_one_pending ON exit_notice(club_id,member_id) WHERE status='Pending';
CREATE TABLE exit_assessment (
 assessment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),club_id UUID NOT NULL REFERENCES club(club_id),
 notice_id UUID NOT NULL REFERENCES exit_notice(notice_id),calculation JSONB NOT NULL,
 assessed_by UUID NOT NULL REFERENCES user_account(user_id),assessed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE exit_notice ADD FOREIGN KEY(assessment_id) REFERENCES exit_assessment(assessment_id);
CREATE TRIGGER exit_assessment_immutable BEFORE UPDATE OR DELETE ON exit_assessment FOR EACH ROW EXECUTE FUNCTION completion_immutable();
CREATE FUNCTION exit_notice_guard() RETURNS TRIGGER AS $$ BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Exit notices cannot be deleted.'; END IF;
 IF OLD.status<>'Pending' OR (NEW.notice_id,NEW.club_id,NEW.member_id,NEW.notice_date,NEW.earliest_exit,NEW.mapping_id,NEW.requested_by,NEW.created_at)
 IS DISTINCT FROM (OLD.notice_id,OLD.club_id,OLD.member_id,OLD.notice_date,OLD.earliest_exit,OLD.mapping_id,OLD.requested_by,OLD.created_at)
 THEN RAISE EXCEPTION 'Exit notice history cannot be changed.'; END IF;
 IF NEW.status='Pending' OR (NEW.status='Approved' AND NEW.assessment_id IS NULL) THEN RAISE EXCEPTION 'Invalid exit decision.'; END IF;
 RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER exit_notice_guard BEFORE UPDATE OR DELETE ON exit_notice FOR EACH ROW EXECUTE FUNCTION exit_notice_guard();
-- Exit forfeiture is retained in the existing pool, not new cash income.
-- Zero-valued Adjustment entries describe the amount retained without doubling it.

-- Tenant identity is enforced below the service layer as well.
ALTER TABLE exit_rule_mapping ADD UNIQUE(club_id,mapping_id);
ALTER TABLE exit_rule_mapping ADD FOREIGN KEY(club_id,constitution_id) REFERENCES constitution(club_id,constitution_id);
ALTER TABLE exit_notice ADD UNIQUE(club_id,notice_id);
ALTER TABLE exit_notice ADD FOREIGN KEY(club_id,member_id) REFERENCES member(club_id,member_id);
ALTER TABLE exit_notice ADD FOREIGN KEY(club_id,mapping_id) REFERENCES exit_rule_mapping(club_id,mapping_id);
ALTER TABLE exit_assessment ADD UNIQUE(club_id,notice_id,assessment_id);
ALTER TABLE exit_assessment ADD FOREIGN KEY(club_id,notice_id) REFERENCES exit_notice(club_id,notice_id);
ALTER TABLE exit_notice ADD FOREIGN KEY(club_id,notice_id,assessment_id) REFERENCES exit_assessment(club_id,notice_id,assessment_id);
