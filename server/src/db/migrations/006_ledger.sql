-- 006_ledger.sql
-- The ledger is the record of account. It is append-only.
--
-- SDD 5.2.2 is explicit that this property must not rest on application code
-- alone, so the protection below is a database rule. A developer who writes an
-- UPDATE against this table by mistake gets an error from PostgreSQL, not a
-- silently corrupted book.

CREATE TYPE ledger_entry_type AS ENUM (
    'Contribution',
    'Penalty',
    'Payout',
    'Claim',
    'Reversal',
    'Adjustment'
);

CREATE TABLE ledger_entry (
    entry_id          UUID              PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id           UUID              NOT NULL REFERENCES club(club_id) ON DELETE RESTRICT,
    member_id         UUID              REFERENCES member(member_id) ON DELETE RESTRICT,

    entry_type        ledger_entry_type NOT NULL,

    -- Signed. Money into the pool is positive, money out is negative. There is
    -- no separate debit/credit column: one signed NUMERIC cannot disagree with
    -- itself.
    amount            NUMERIC(12,2)     NOT NULL,

    -- Pool balance immediately after this entry. Stored so that a statement can
    -- be printed without recomputing the whole book, and so that a gap in the
    -- running balance is visible evidence of tampering.
    resulting_balance NUMERIC(12,2)     NOT NULL,

    description       TEXT              NOT NULL,
    reference         VARCHAR(80),

    -- Set on a reversing entry, pointing at the entry being reversed (REQ-91).
    -- The original row stays exactly where it is; correction is a new opposing
    -- entry, never an edit.
    reverses_id       UUID              REFERENCES ledger_entry(entry_id),
    reason            TEXT,             -- required when reverses_id is set

    contribution_id   UUID              REFERENCES contribution(contribution_id),
    penalty_id        UUID              REFERENCES penalty(penalty_id),

    posted_by         UUID              NOT NULL REFERENCES user_account(user_id),
    posted_at         TIMESTAMPTZ       NOT NULL DEFAULT now(),

    CONSTRAINT reversal_needs_reason
        CHECK (reverses_id IS NULL OR reason IS NOT NULL)
);

CREATE INDEX ledger_club_idx        ON ledger_entry (club_id, posted_at DESC);
CREATE INDEX ledger_member_idx      ON ledger_entry (club_id, member_id, posted_at);
CREATE UNIQUE INDEX ledger_one_reversal_per_entry
    ON ledger_entry (reverses_id) WHERE reverses_id IS NOT NULL;

-- ---------------------------------------------------------------------------
-- Append-only enforcement
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION ledger_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'ledger_entry is append-only: % is not permitted. Post a reversing entry instead (REQ-91).',
        TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER ledger_no_update
    BEFORE UPDATE ON ledger_entry
    FOR EACH ROW EXECUTE FUNCTION ledger_is_append_only();

CREATE TRIGGER ledger_no_delete
    BEFORE DELETE ON ledger_entry
    FOR EACH ROW EXECUTE FUNCTION ledger_is_append_only();

-- ---------------------------------------------------------------------------
-- reconciliation (REQ-96, REQ-97, REQ-98)
-- ---------------------------------------------------------------------------
CREATE TABLE reconciliation (
    reconciliation_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id           UUID          NOT NULL REFERENCES club(club_id) ON DELETE CASCADE,
    as_at_date        DATE          NOT NULL,
    bank_balance      NUMERIC(12,2) NOT NULL,
    ledger_balance    NUMERIC(12,2) NOT NULL,
    difference        NUMERIC(12,2) NOT NULL,
    note              TEXT,
    recorded_by       UUID          NOT NULL REFERENCES user_account(user_id),
    recorded_at       TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX reconciliation_club_idx ON reconciliation (club_id, as_at_date DESC);