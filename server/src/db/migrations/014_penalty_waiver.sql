-- 014_penalty_waiver.sql
-- REQ-63, BR-13.
--
-- migration 005 already has waived_at, waived_by AND waiver_reason on
-- `penalty` (checked here before assuming otherwise). What was missing: a
-- CHECK that a reason is actually required when a penalty is marked waived,
-- and a rule that a waiver, once recorded, cannot be quietly undone or
-- reworded. Reversal of the MONEY is REQ-63's own job (a reversing ledger
-- entry, migration 006 already supports one) — this migration only protects
-- the WAIVER RECORD itself.

ALTER TABLE penalty ADD CONSTRAINT penalty_waiver_needs_reason
    CHECK (waived_at IS NULL OR (waived_by IS NOT NULL AND waiver_reason IS NOT NULL));

-- settled_amount keeps changing after a penalty is levied (excess payments
-- settle it down over time), so this table is not made fully immutable the
-- way payout, distribution and burial_claim are. Only the three waiver
-- columns are frozen, and only once they are actually set.
CREATE OR REPLACE FUNCTION penalty_waiver_is_final()
RETURNS TRIGGER AS $$
BEGIN
    IF OLD.waived_at IS NOT NULL AND (
        NEW.waived_at      IS DISTINCT FROM OLD.waived_at
     OR NEW.waived_by      IS DISTINCT FROM OLD.waived_by
     OR NEW.waiver_reason  IS DISTINCT FROM OLD.waiver_reason
    ) THEN
        RAISE EXCEPTION 'this penalty has already been waived and the waiver cannot be changed.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER penalty_waiver_no_tamper
    BEFORE UPDATE ON penalty
    FOR EACH ROW EXECUTE FUNCTION penalty_waiver_is_final();