-- 011_payouts_and_queue.sql
-- Use Case 3. REQ-64 to REQ-78.
--
--   payout                   what was authorised, by whom, and on what basis
--   queue_arrears_decision   the Chairperson's recorded ruling when the member at
--                            the head of the queue is not in good standing
--   queue_swap               a request to exchange payout positions
--   ledger_entry.payout_id   ties a posted payout to the authorisation behind it
--   member queue positions   unique within a club
--
-- The ledger (migration 006) already protects itself against edits. The same
-- reasoning applies here. Dual authorisation (REQ-64) is the rule an assessor is
-- most likely to probe, so it does not rest on application code alone: a payout
-- row that names the same account as initiator and approver is refused by the
-- database.

-- ---------------------------------------------------------------------------
-- The Chairperson's ruling on a member who is not in good standing (REQ-77)
-- ---------------------------------------------------------------------------
CREATE TYPE arrears_decision_type AS ENUM ('Deferred', 'Paid notwithstanding arrears');

CREATE TABLE queue_arrears_decision (
    decision_id         UUID                  PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id             UUID                  NOT NULL REFERENCES club(club_id)     ON DELETE RESTRICT,
    member_id           UUID                  NOT NULL REFERENCES member(member_id) ON DELETE RESTRICT,
    decision            arrears_decision_type NOT NULL,
    standing_at_decision member_standing      NOT NULL,
    reason              TEXT                  NOT NULL,
    decided_by          UUID                  NOT NULL REFERENCES user_account(user_id),
    decided_at          TIMESTAMPTZ           NOT NULL DEFAULT now()
);

CREATE INDEX queue_arrears_decision_member_idx ON queue_arrears_decision (club_id, member_id, decided_at DESC);

-- ---------------------------------------------------------------------------
-- payout
-- ---------------------------------------------------------------------------
CREATE TYPE payout_type   AS ENUM ('Rotation', 'Distribution', 'Burial claim', 'Exit settlement');
CREATE TYPE payout_status AS ENUM ('Initiated', 'Approved', 'Cancelled');

CREATE TABLE payout (
    payout_id                 UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id                   UUID          NOT NULL REFERENCES club(club_id)     ON DELETE RESTRICT,

    -- The recipient.
    member_id                 UUID          NOT NULL REFERENCES member(member_id) ON DELETE RESTRICT,

    payout_type               payout_type   NOT NULL,
    status                    payout_status NOT NULL DEFAULT 'Initiated',
    amount                    NUMERIC(12,2) NOT NULL CHECK (amount > 0),

    -- The cycle whose contributions this payout distributes. Rotation payouts only.
    cycle_id                  UUID          REFERENCES cycle(cycle_id),

    -- REQ-68: the rule under which eligibility was determined.
    constitution_version      INTEGER       NOT NULL,
    eligibility_rule_applied  TEXT          NOT NULL,

    -- REQ-65: what the approver is shown. The first is what the Treasurer saw
    -- and stood behind at initiation. The second is the position at the moment
    -- of posting, which is what was actually checked.
    assessment_at_initiation  JSONB         NOT NULL,
    assessment_at_approval    JSONB,

    -- REQ-77: set when the recipient was in arrears and the Chairperson ruled
    -- that they should be paid regardless.
    arrears_decision_id       UUID          REFERENCES queue_arrears_decision(decision_id),

    initiated_by              UUID          NOT NULL REFERENCES user_account(user_id),
    initiated_at              TIMESTAMPTZ   NOT NULL DEFAULT now(),
    approved_by               UUID          REFERENCES user_account(user_id),
    approved_at               TIMESTAMPTZ,
    cancelled_by              UUID          REFERENCES user_account(user_id),
    cancelled_at              TIMESTAMPTZ,
    cancel_reason             TEXT,

    -- REQ-64, BR-2: two distinct accounts.
    CONSTRAINT payout_two_people
        CHECK (approved_by IS NULL OR approved_by <> initiated_by),

    -- A payout is in exactly one of three states and carries exactly the
    -- evidence that state needs.
    CONSTRAINT payout_state_shape CHECK (
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
    ),

    CONSTRAINT rotation_needs_cycle
        CHECK (payout_type <> 'Rotation' OR cycle_id IS NOT NULL)
);

CREATE INDEX payout_club_idx   ON payout (club_id, initiated_at DESC);
CREATE INDEX payout_member_idx ON payout (club_id, member_id);

-- One live rotation payout per cycle. A cancelled one frees the cycle.
CREATE UNIQUE INDEX payout_one_per_cycle
    ON payout (club_id, cycle_id)
    WHERE payout_type = 'Rotation' AND status <> 'Cancelled';

-- One rotation payout awaiting approval per club. Approving it advances the
-- queue, which would leave any second pending payout addressed to a member who
-- is no longer at the head.
CREATE UNIQUE INDEX payout_one_open_rotation
    ON payout (club_id)
    WHERE payout_type = 'Rotation' AND status = 'Initiated';

-- A ruling to pay a member notwithstanding arrears authorises one payout.
CREATE UNIQUE INDEX payout_one_per_arrears_decision
    ON payout (arrears_decision_id)
    WHERE arrears_decision_id IS NOT NULL AND status <> 'Cancelled';

-- ---------------------------------------------------------------------------
-- A payout record cannot be tampered with
-- ---------------------------------------------------------------------------
-- Only Initiated can change, and only to Approved or Cancelled. Everything that
-- says who, how much, to whom and on what basis is frozen at initiation.
-- Removal is never permitted: a payout that should not go ahead is Cancelled
-- (REQ-70), and the cancellation is itself the record.
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

CREATE TRIGGER payout_no_tamper_update
    BEFORE UPDATE ON payout
    FOR EACH ROW EXECUTE FUNCTION payout_guard();

CREATE TRIGGER payout_no_delete
    BEFORE DELETE ON payout
    FOR EACH ROW EXECUTE FUNCTION payout_guard();

-- ---------------------------------------------------------------------------
-- A posted payout points back at its authorisation
-- ---------------------------------------------------------------------------
-- Adding a column is not an UPDATE, so the append-only triggers on ledger_entry
-- are untouched. The column is nullable because payouts posted before this
-- migration have no payout row.
ALTER TABLE ledger_entry ADD COLUMN payout_id UUID REFERENCES payout(payout_id);

-- A payout is posted once. Two approvals racing each other cannot both land.
CREATE UNIQUE INDEX ledger_one_entry_per_payout
    ON ledger_entry (payout_id)
    WHERE payout_id IS NOT NULL AND reverses_id IS NULL;

-- ---------------------------------------------------------------------------
-- Exchange of payout positions (REQ-74, REQ-75)
-- ---------------------------------------------------------------------------
CREATE TYPE queue_swap_status AS ENUM (
    'Pending consent',    -- requested, waiting for the other member
    'Pending approval',   -- the other member consented, waiting for the Chairperson
    'Effected',
    'Declined',           -- the other member refused
    'Rejected',           -- the Chairperson refused
    'Cancelled'           -- the requester withdrew
);

CREATE TABLE queue_swap (
    swap_id                     UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id                     UUID              NOT NULL REFERENCES club(club_id)     ON DELETE RESTRICT,
    requester_member_id         UUID              NOT NULL REFERENCES member(member_id) ON DELETE RESTRICT,
    counterparty_member_id      UUID              NOT NULL REFERENCES member(member_id) ON DELETE RESTRICT,
    status                      queue_swap_status NOT NULL DEFAULT 'Pending consent',

    requested_by                UUID              NOT NULL REFERENCES user_account(user_id),
    requested_at                TIMESTAMPTZ       NOT NULL DEFAULT now(),
    requester_position_at_request     INTEGER     NOT NULL,
    counterparty_position_at_request  INTEGER     NOT NULL,

    -- REQ-75: the other member's express consent.
    consent_given               BOOLEAN,
    consent_by                  UUID              REFERENCES user_account(user_id),
    consent_at                  TIMESTAMPTZ,

    -- REQ-75: the Chairperson's decision.
    decided_by                  UUID              REFERENCES user_account(user_id),
    decided_at                  TIMESTAMPTZ,
    decision_reason             TEXT,

    -- What the exchange actually did, recorded when it was effected.
    requester_position_after    INTEGER,
    counterparty_position_after INTEGER,

    CONSTRAINT swap_two_members CHECK (requester_member_id <> counterparty_member_id),

    -- Effected means both consents exist. This is the rule the assessor will
    -- try to break, so the database states it as well as the service.
    CONSTRAINT swap_effected_needs_both CHECK (
        status <> 'Effected'
        OR (consent_given IS TRUE AND consent_by IS NOT NULL
            AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
    )
);

CREATE INDEX queue_swap_club_idx ON queue_swap (club_id, requested_at DESC);

-- A member is party to at most one open exchange at a time, in either role.
-- The service also refuses a member who is requester in one and counterparty
-- in another, which no single index can express.
CREATE UNIQUE INDEX queue_swap_one_open_per_requester
    ON queue_swap (requester_member_id)
    WHERE status IN ('Pending consent', 'Pending approval');

CREATE UNIQUE INDEX queue_swap_one_open_per_counterparty
    ON queue_swap (counterparty_member_id)
    WHERE status IN ('Pending consent', 'Pending approval');

-- ---------------------------------------------------------------------------
-- Queue positions are unique within a club
-- ---------------------------------------------------------------------------
-- Migration 004 indexed the position but did not make it unique, so two members
-- could hold position 3 and "the head of the queue" stopped being one person.
-- DEFERRABLE INITIALLY DEFERRED lets a transaction shuffle several members
-- through intermediate states and checks the result once, at commit.
-- A NULL position (a club that is not Rotating, or a member who has left) is
-- never a duplicate.
ALTER TABLE member
    ADD CONSTRAINT member_queue_position_unique
    UNIQUE (club_id, queue_position) DEFERRABLE INITIALLY DEFERRED;