-- 013_burial_claims.sql
-- Use Case 4. REQ-83 to REQ-88.
--
--   burial_claim         REQ-83: what was claimed, for whom, and on what basis
--   payout.claim_id      the payout it becomes, once initiated (same pattern
--                         as payout.cycle_id and payout.distribution_id)
--
-- No table change is needed for `dependant` (migration 004 already has
-- everything REQ-37 and REQ-85 need) or for the benefit schedule (REQ-27,
-- already on `constitution`).
--
-- A claim's own lifecycle is deliberately separate from a payout's. Lodging a
-- claim (REQ-83 to REQ-87) can be refused for reasons that have nothing to do
-- with money (the claimant's standing, whether the dependant is covered, the
-- waiting period) before any payout is ever considered. Only a claim that
-- survives lodgement becomes something the Treasurer can initiate payment for,
-- which is where REQ-88's ordering and pool-sufficiency rule applies.

CREATE TYPE claim_status AS ENUM ('Lodged', 'Initiated', 'Approved', 'Cancelled');

CREATE TABLE burial_claim (
    claim_id                UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id                  UUID         NOT NULL REFERENCES club(club_id)       ON DELETE RESTRICT,

    -- The claimant: the living member the payout is made to (REQ-83). Distinct
    -- from the dependant, whose death triggered the claim (migration 004's own
    -- comment on this distinction).
    member_id                 UUID        NOT NULL REFERENCES member(member_id)     ON DELETE RESTRICT,
    dependant_id               UUID       NOT NULL REFERENCES dependant(dependant_id) ON DELETE RESTRICT,

    status                     claim_status NOT NULL DEFAULT 'Lodged',

    date_of_death                DATE     NOT NULL,
    description                  TEXT,    -- REQ-83: supporting documentation, as a reference or note

    -- REQ-86: resolved once, at lodgement, against the constitution in force
    -- on the date of death, and never recomputed. A later amendment to the
    -- benefit schedule must not change what a claim already lodged is worth.
    constitution_version         INTEGER       NOT NULL,
    dependant_category           VARCHAR(60)   NOT NULL,
    benefit_amount                NUMERIC(12,2) NOT NULL CHECK (benefit_amount > 0),

    lodged_by                     UUID     NOT NULL REFERENCES user_account(user_id),
    lodged_at                     TIMESTAMPTZ NOT NULL DEFAULT now(),

    initiated_by                   UUID    REFERENCES user_account(user_id),
    initiated_at                   TIMESTAMPTZ,
    approved_by                     UUID   REFERENCES user_account(user_id),
    approved_at                     TIMESTAMPTZ,
    cancelled_by                     UUID  REFERENCES user_account(user_id),
    cancelled_at                     TIMESTAMPTZ,
    cancel_reason                     TEXT,

    -- REQ-64, BR-2, the same rule as every other payout.
    CONSTRAINT claim_two_people
        CHECK (approved_by IS NULL OR initiated_by IS NULL OR approved_by <> initiated_by),

    CONSTRAINT claim_state_shape CHECK (
        (status = 'Lodged'
            AND initiated_by IS NULL AND initiated_at IS NULL
            AND approved_by  IS NULL AND approved_at  IS NULL
            AND cancelled_by IS NULL AND cancelled_at IS NULL)
     OR (status = 'Initiated'
            AND initiated_by IS NOT NULL AND initiated_at IS NOT NULL
            AND approved_by  IS NULL AND approved_at  IS NULL
            AND cancelled_by IS NULL AND cancelled_at IS NULL)
     OR (status = 'Approved'
            AND initiated_by IS NOT NULL AND initiated_at IS NOT NULL
            AND approved_by  IS NOT NULL AND approved_at  IS NOT NULL
            AND cancelled_by IS NULL AND cancelled_at IS NULL)
     OR (status = 'Cancelled'
            AND cancelled_by IS NOT NULL AND cancelled_at IS NOT NULL
            AND cancel_reason IS NOT NULL
            AND approved_by  IS NULL AND approved_at  IS NULL)
    )
);

CREATE INDEX claim_club_idx      ON burial_claim (club_id, lodged_at ASC);
CREATE INDEX claim_dependant_idx ON burial_claim (dependant_id);

-- REQ-88: one payout in flight at a time, so the FIFO ordering the service
-- enforces cannot be bypassed by starting a second one before the first is
-- resolved.
CREATE UNIQUE INDEX claim_one_open_per_club
    ON burial_claim (club_id) WHERE status = 'Initiated';

-- A dependant is claimed at most once. A second claim naming the same
-- dependant, however it got past the service, cannot also become live.
CREATE UNIQUE INDEX claim_one_per_dependant
    ON burial_claim (dependant_id) WHERE status <> 'Cancelled';

-- Frozen the same way a payout and a distribution are: Lodged moves to
-- Initiated, Initiated moves to Approved or Cancelled, and no further. What
-- REQ-86 resolved at lodgement is fixed for good once a payout is initiated
-- against it.
CREATE OR REPLACE FUNCTION claim_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a claim record cannot be deleted. Cancel it instead (REQ-70).'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.status = 'Approved' OR OLD.status = 'Cancelled' THEN
        RAISE EXCEPTION 'claim % is % and can no longer be changed.', OLD.claim_id, OLD.status
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.status = 'Lodged' AND NEW.status NOT IN ('Initiated', 'Cancelled') THEN
        RAISE EXCEPTION 'a Lodged claim may only be initiated for payment or cancelled.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'Initiated' AND NEW.status NOT IN ('Approved', 'Cancelled') THEN
        RAISE EXCEPTION 'an Initiated claim may only be approved or cancelled.'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.club_id               IS DISTINCT FROM OLD.club_id
    OR NEW.member_id              IS DISTINCT FROM OLD.member_id
    OR NEW.dependant_id           IS DISTINCT FROM OLD.dependant_id
    OR NEW.date_of_death          IS DISTINCT FROM OLD.date_of_death
    OR NEW.constitution_version   IS DISTINCT FROM OLD.constitution_version
    OR NEW.dependant_category     IS DISTINCT FROM OLD.dependant_category
    OR NEW.benefit_amount         IS DISTINCT FROM OLD.benefit_amount
    OR NEW.lodged_by              IS DISTINCT FROM OLD.lodged_by
    OR NEW.lodged_at              IS DISTINCT FROM OLD.lodged_at THEN
        RAISE EXCEPTION 'what a claim was lodged for cannot be altered (REQ-86).'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER claim_no_tamper_update
    BEFORE UPDATE ON burial_claim
    FOR EACH ROW EXECUTE FUNCTION claim_guard();

CREATE TRIGGER claim_no_delete
    BEFORE DELETE ON burial_claim
    FOR EACH ROW EXECUTE FUNCTION claim_guard();

-- A dependant already claimed (a live, non-Cancelled claim exists) cannot be
-- removed out from under that claim's own record.
CREATE OR REPLACE FUNCTION dependant_guard_claimed()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.removed_at IS NOT NULL AND OLD.removed_at IS NULL
       AND EXISTS (SELECT 1 FROM burial_claim WHERE dependant_id = NEW.dependant_id AND status <> 'Cancelled') THEN
        RAISE EXCEPTION 'this dependant has a claim on record and cannot be removed.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER dependant_no_remove_if_claimed
    BEFORE UPDATE ON dependant
    FOR EACH ROW EXECUTE FUNCTION dependant_guard_claimed();

-- ---------------------------------------------------------------------------
-- Each claim's payment is its own payout row, the same pattern as a rotation
-- payout (cycle_id) and a distribution's per-member share (distribution_id).
-- ---------------------------------------------------------------------------
ALTER TABLE payout ADD COLUMN claim_id UUID REFERENCES burial_claim(claim_id);

ALTER TABLE payout ADD CONSTRAINT claim_needs_claim_id
    CHECK (payout_type <> 'Burial claim' OR claim_id IS NOT NULL);

CREATE UNIQUE INDEX payout_one_per_claim
    ON payout (claim_id) WHERE claim_id IS NOT NULL;

-- payout_guard() (migration 011, extended in 012) is redefined again to also
-- freeze claim_id. CREATE OR REPLACE updates the function the existing
-- triggers already point at; the triggers themselves are unchanged.
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
    OR NEW.claim_id                 IS DISTINCT FROM OLD.claim_id
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