ALTER TABLE ledger_reversal_request ADD UNIQUE(club_id,request_id);
CREATE TABLE reversal_bundle (
 club_id UUID NOT NULL REFERENCES club(club_id),
 root_request_id UUID NOT NULL,
 request_id UUID PRIMARY KEY,
 scope TEXT NOT NULL CHECK(scope IN ('Distribution','Exit settlement')),
 target_id UUID NOT NULL,
 FOREIGN KEY(club_id,root_request_id) REFERENCES ledger_reversal_request(club_id,request_id),
 FOREIGN KEY(club_id,request_id) REFERENCES ledger_reversal_request(club_id,request_id)
);
CREATE INDEX reversal_bundle_root ON reversal_bundle(club_id,root_request_id);
CREATE TRIGGER reversal_bundle_immutable BEFORE UPDATE OR DELETE ON reversal_bundle FOR EACH ROW EXECUTE FUNCTION completion_immutable();
CREATE TABLE exit_effect (
 club_id UUID NOT NULL REFERENCES club(club_id), notice_id UUID PRIMARY KEY,
 member_before JSONB NOT NULL, queue_before JSONB NOT NULL, queue_after JSONB NOT NULL,
 penalty_allocations JSONB NOT NULL,
 FOREIGN KEY(club_id,notice_id) REFERENCES exit_notice(club_id,notice_id)
);
CREATE TRIGGER exit_effect_immutable BEFORE UPDATE OR DELETE ON exit_effect FOR EACH ROW EXECUTE FUNCTION completion_immutable();
CREATE TABLE exit_reversal (
 club_id UUID NOT NULL REFERENCES club(club_id), notice_id UUID PRIMARY KEY,
 request_id UUID NOT NULL UNIQUE, reversed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
 FOREIGN KEY(club_id,notice_id) REFERENCES exit_notice(club_id,notice_id),
 FOREIGN KEY(club_id,request_id) REFERENCES ledger_reversal_request(club_id,request_id)
);
CREATE TRIGGER exit_reversal_immutable BEFORE UPDATE OR DELETE ON exit_reversal FOR EACH ROW EXECUTE FUNCTION completion_immutable();
ALTER TABLE distribution ADD COLUMN reversed_by_request_id UUID REFERENCES ledger_reversal_request(request_id);
DROP INDEX distribution_one_per_year_end;
CREATE UNIQUE INDEX distribution_one_per_year_end ON distribution(club_id,year_end_date)
 WHERE status<>'Cancelled' AND reversed_by_request_id IS NULL;
CREATE OR REPLACE FUNCTION distribution_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP='UPDATE' AND NEW.reversed_by_request_id IS DISTINCT FROM OLD.reversed_by_request_id THEN
      IF OLD.status<>'Approved' OR OLD.reversed_by_request_id IS NOT NULL OR
        (to_jsonb(NEW)-'reversed_by_request_id') IS DISTINCT FROM (to_jsonb(OLD)-'reversed_by_request_id') OR
        NOT EXISTS(SELECT 1 FROM reversal_bundle b JOIN ledger_reversal_request r ON r.club_id=b.club_id AND r.request_id=b.root_request_id
          WHERE b.club_id=NEW.club_id AND b.target_id=NEW.distribution_id AND b.scope='Distribution' AND b.root_request_id=NEW.reversed_by_request_id AND r.status='Posted') OR
        EXISTS(SELECT 1 FROM payout WHERE club_id=NEW.club_id AND distribution_id=NEW.distribution_id AND reversed_entry_id IS NULL)
        THEN RAISE EXCEPTION 'A distribution reversal must compensate every approved share'; END IF;
      RETURN NEW;
    END IF;
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'distribution records cannot be deleted. Cancel it instead (REQ-70).'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.status <> 'Initiated' THEN
        RAISE EXCEPTION 'distribution % is % and can no longer be changed.', OLD.distribution_id, OLD.status
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.status = 'Initiated' THEN
        RAISE EXCEPTION 'an Initiated distribution may only be approved or cancelled.'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.club_id                IS DISTINCT FROM OLD.club_id
    OR NEW.year_end_date          IS DISTINCT FROM OLD.year_end_date
    OR NEW.period_start           IS DISTINCT FROM OLD.period_start
    OR NEW.period_end             IS DISTINCT FROM OLD.period_end
    OR NEW.constitution_version   IS DISTINCT FROM OLD.constitution_version
    OR NEW.total_contributions    IS DISTINCT FROM OLD.total_contributions
    OR NEW.total_penalties        IS DISTINCT FROM OLD.total_penalties
    OR NEW.total_interest         IS DISTINCT FROM OLD.total_interest
    OR NEW.total_expenses         IS DISTINCT FROM OLD.total_expenses
    OR NEW.total_distributed      IS DISTINCT FROM OLD.total_distributed
    OR NEW.pool_at_computation    IS DISTINCT FROM OLD.pool_at_computation
    OR NEW.assessment_at_initiation IS DISTINCT FROM OLD.assessment_at_initiation
    OR NEW.initiated_by           IS DISTINCT FROM OLD.initiated_by
    OR NEW.initiated_at           IS DISTINCT FROM OLD.initiated_at THEN
        RAISE EXCEPTION 'what a distribution was initiated for cannot be altered (REQ-82).'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

