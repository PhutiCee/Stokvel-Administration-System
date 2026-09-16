-- 009_contribution_rules.sql
--
-- Three corrections and additions the contribution rules require.

-- ---------------------------------------------------------------------------
-- 1. Payment methods. REQ-51 names exactly {Cash, Electronic funds transfer,
--    Other}. Migration 005 had "Debit order" instead of "Other", which is a
--    defect against the requirement: a club that receives a postal order or a
--    cheque had nothing to record it as.
--
--    A value cannot be removed from a PostgreSQL enum, so the type is rebuilt.
--    The column is widened to text, the old type dropped, the new one created,
--    existing rows remapped, and the column narrowed again — all inside the
--    migration's transaction, so a failure leaves nothing half-done.
-- ---------------------------------------------------------------------------

ALTER TABLE contribution ALTER COLUMN method TYPE text;

DROP TYPE payment_method;

CREATE TYPE payment_method AS ENUM ('Cash', 'Electronic funds transfer', 'Other');

UPDATE contribution SET method = 'Other' WHERE method = 'Debit order';

ALTER TABLE contribution
    ALTER COLUMN method TYPE payment_method USING method::payment_method;

-- ---------------------------------------------------------------------------
-- 2. Credit carried to the succeeding cycle.
--
--    REQ-57: an overpayment is applied first to an outstanding penalty, then
--    to prior outstanding contributions oldest first, and only then held as a
--    credit against the next cycle. That last part needs somewhere to live.
--
--    It sits on the membership rather than in the ledger because it is not
--    money moving — the cash is already in the pool and already recorded. This
--    is a note about whose money it is.
-- ---------------------------------------------------------------------------

ALTER TABLE member
    ADD COLUMN credit_amount NUMERIC(12,2) NOT NULL DEFAULT 0
    CHECK (credit_amount >= 0);

-- ---------------------------------------------------------------------------
-- 3. One penalty per member per cycle. REQ-56 requires the late penalty to be
--    posted "once only in respect of a given member and cycle".
--
--    Enforced as a unique index rather than a check in the service, because the
--    penalty is posted automatically whenever a status resolves to Late, and
--    two requests resolving the same status at the same moment would otherwise
--    both succeed. A member would be fined twice for one late payment, and
--    would be right to be angry about it.
-- ---------------------------------------------------------------------------

CREATE UNIQUE INDEX penalty_one_per_member_cycle
    ON penalty (club_id, member_id, cycle_id)
    WHERE cycle_id IS NOT NULL;

-- Faster lookup of a member's unsettled penalties, which applyExcess() walks
-- on every overpayment.
CREATE INDEX penalty_unsettled_idx
    ON penalty (club_id, member_id, levied_at)
    WHERE waived_at IS NULL;