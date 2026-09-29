-- 012_distributions.sql
-- Use Case 3, accumulating clubs. REQ-79 to REQ-82.
--
--   constitution.year_end_month/day   REQ-79: the date the constitution names
--   ledger_entry_type + Interest, Expense   the two figures REQ-80 needs and
--                                            nothing in the schema captured yet
--   distribution                      one year-end computation, itemised,
--                                      dual-authorised, frozen once decided
--   payout.distribution_id            each member's share as its own payout
--                                      row, the same way a rotation payout is
--                                      one row per recipient
--
-- No SRS requirement names the mechanism for recording interest earned or
-- administrative costs. Both are real inputs to REQ-80's formula and nothing
-- upstream of this migration produces them, so this migration adds the two
-- entry types needed to record them as they occur, at the club level, the same
-- way a Contribution or Penalty entry is recorded as it occurs. See
-- decisions.md.

-- ---------------------------------------------------------------------------
-- REQ-79: the year-end date is a property of the constitution, recurring
-- annually. Nullable: only an Accumulating club needs it, the same way only a
-- Burial society needs a benefit schedule. The type-conditional requirement is
-- enforced in rules/constitution.js, not here, matching how waiting_period_days
-- and benefit_schedule are handled.
-- ---------------------------------------------------------------------------
ALTER TABLE constitution
    ADD COLUMN year_end_month SMALLINT CHECK (year_end_month BETWEEN 1 AND 12),
    ADD COLUMN year_end_day   SMALLINT CHECK (year_end_day   BETWEEN 1 AND 31);

-- ---------------------------------------------------------------------------
-- REQ-80: interest earned and administrative costs, recorded as they occur.
-- ---------------------------------------------------------------------------
ALTER TYPE ledger_entry_type ADD VALUE 'Interest';
ALTER TYPE ledger_entry_type ADD VALUE 'Expense';

-- ---------------------------------------------------------------------------
-- distribution
-- ---------------------------------------------------------------------------
-- One row per year-end computation. REQ-82 requires the full computation,
-- itemised by member, to be presented for approval before anything posts; that
-- itemisation is assessment_at_initiation, the same pattern payout uses for
-- REQ-65. The totals columns are not a second source of truth for the pool —
-- getPoolBalance() is still computed from the ledger alone — they are the
-- figures the computation was founded on, kept so the record explains itself
-- without recomputing history.
CREATE TYPE distribution_status AS ENUM ('Initiated', 'Approved', 'Cancelled');

CREATE TABLE distribution (
    distribution_id            UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id                    UUID                NOT NULL REFERENCES club(club_id) ON DELETE RESTRICT,
    status                     distribution_status NOT NULL DEFAULT 'Initiated',

    -- REQ-79: the concrete date this computation is for, and the window of
    -- activity it covers. period_start is exclusive, period_end inclusive: an
    -- entry posted exactly at period_start belongs to the PRIOR distribution.
    year_end_date              DATE                NOT NULL,
    period_start                DATE               NOT NULL,
    period_end                  DATE               NOT NULL,
    CONSTRAINT distribution_period_ordered CHECK (period_end > period_start),

    constitution_version       INTEGER             NOT NULL,

    -- The figures the computation was founded on (REQ-80's four terms, plus
    -- the pool it was checked against, REQ-81).
    total_contributions        NUMERIC(12,2)       NOT NULL,
    total_penalties            NUMERIC(12,2)       NOT NULL,
    total_interest             NUMERIC(12,2)       NOT NULL,
    total_expenses             NUMERIC(12,2)       NOT NULL,
    total_distributed          NUMERIC(12,2)       NOT NULL CHECK (total_distributed >= 0),
    pool_at_computation         NUMERIC(12,2)       NOT NULL,

    -- REQ-82: itemised by member, as shown to the Chairperson. The second is
    -- null until approval, and is the itemisation re-checked against the pool
    -- at that moment (REQ-81 is re-verified at approval, the same as REQ-66
    -- and REQ-67 are for a rotation payout).
    assessment_at_initiation   JSONB               NOT NULL,
    assessment_at_approval     JSONB,

    initiated_by                UUID               NOT NULL REFERENCES user_account(user_id),
    initiated_at                TIMESTAMPTZ        NOT NULL DEFAULT now(),
    approved_by                  UUID              REFERENCES user_account(user_id),
    approved_at                  TIMESTAMPTZ,
    cancelled_by                 UUID              REFERENCES user_account(user_id),
    cancelled_at                 TIMESTAMPTZ,
    cancel_reason                TEXT,

    -- REQ-64, BR-2, the same rule that governs every payout.
    CONSTRAINT distribution_two_people
        CHECK (approved_by IS NULL OR approved_by <> initiated_by),

    CONSTRAINT distribution_state_shape CHECK (
        (status = 'Initiated'
            AND approved_by IS NULL AND approved_at IS NULL
            AND cancelled_by IS NULL AND cancelled_at IS NULL)
     OR (status = 'Approved'
            AND approved_by IS NOT NULL AND approved_at IS NOT NULL
            AND assessment_at_approval IS NOT NULL
            AND cancelled_by IS NULL AND cancelled_at IS NULL)
     OR (status = 'Cancelled'
            AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL
            AND cancel_reason IS NOT NULL
            AND approved_by IS NULL AND approved_at IS NULL)
    )
);

CREATE INDEX distribution_club_idx ON distribution (club_id, initiated_at DESC);

-- One computation waiting for approval, and one covering a given year-end
-- date, per club. Without the second, retrying a refused initiation could
-- leave two live computations for the same year-end once the first was
-- cancelled and re-tried out of order.
CREATE UNIQUE INDEX distribution_one_open_per_club
    ON distribution (club_id) WHERE status = 'Initiated';
CREATE UNIQUE INDEX distribution_one_per_year_end
    ON distribution (club_id, year_end_date) WHERE status <> 'Cancelled';

-- Frozen the same way a payout is (migration 011): Initiated moves to Approved
-- or Cancelled and no further; every fact about what was computed is fixed
-- once approved; deletion is refused, a wrong distribution is cancelled.
CREATE OR REPLACE FUNCTION distribution_guard()
RETURNS TRIGGER AS $$
BEGIN
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

CREATE TRIGGER distribution_no_tamper_update
    BEFORE UPDATE ON distribution
    FOR EACH ROW EXECUTE FUNCTION distribution_guard();

CREATE TRIGGER distribution_no_delete
    BEFORE DELETE ON distribution
    FOR EACH ROW EXECUTE FUNCTION distribution_guard();

-- ---------------------------------------------------------------------------
-- Each member's share is its own payout row, the same as a rotation payout
-- ---------------------------------------------------------------------------
-- This lets a member see their distribution payment in the same place they see
-- everything else paid to them (GET /api/payouts, their own statement), rather
-- than only as a line inside somebody else's approval screen.
ALTER TABLE payout ADD COLUMN distribution_id UUID REFERENCES distribution(distribution_id);

ALTER TABLE payout ADD CONSTRAINT distribution_needs_distribution_id
    CHECK (payout_type <> 'Distribution' OR distribution_id IS NOT NULL);

CREATE UNIQUE INDEX payout_one_per_distribution_member
    ON payout (distribution_id, member_id) WHERE distribution_id IS NOT NULL;

-- payout_guard() (migration 011) is redefined here to also freeze distribution_id.
-- CREATE OR REPLACE on the same function name updates the trigger already
-- attached to payout; the trigger itself does not need to be re-created.
CREATE OR REPLACE FUNCTION payout_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'payout records cannot be deleted. Cancel the payout instead (REQ-70).'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.status <> 'Initiated' THEN
        RAISE EXCEPTION 'payout % is % and can no longer be changed.', OLD.payout_id, OLD.status
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.status = 'Initiated' THEN
        RAISE EXCEPTION 'an Initiated payout may only be approved or cancelled.'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.club_id                  IS DISTINCT FROM OLD.club_id
    OR NEW.member_id                IS DISTINCT FROM OLD.member_id
    OR NEW.payout_type              IS DISTINCT FROM OLD.payout_type
    OR NEW.amount                   IS DISTINCT FROM OLD.amount
    OR NEW.cycle_id                 IS DISTINCT FROM OLD.cycle_id
    OR NEW.distribution_id          IS DISTINCT FROM OLD.distribution_id
    OR NEW.constitution_version     IS DISTINCT FROM OLD.constitution_version
    OR NEW.eligibility_rule_applied IS DISTINCT FROM OLD.eligibility_rule_applied
    OR NEW.assessment_at_initiation IS DISTINCT FROM OLD.assessment_at_initiation
    OR NEW.arrears_decision_id      IS DISTINCT FROM OLD.arrears_decision_id
    OR NEW.initiated_by             IS DISTINCT FROM OLD.initiated_by
    OR NEW.initiated_at             IS DISTINCT FROM OLD.initiated_at THEN
        RAISE EXCEPTION 'what a payout was initiated for cannot be altered (REQ-68).'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;