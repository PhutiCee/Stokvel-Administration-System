-- 003_club.sql
-- The club is the tenant. Every table created after this one carries club_id
-- and is indexed on it (SDD 5.2.2).

CREATE TYPE club_type   AS ENUM ('Rotating', 'Accumulating', 'Burial');
CREATE TYPE club_status AS ENUM ('Active', 'Suspended');

CREATE TABLE club (
    club_id           UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    name              VARCHAR(120) NOT NULL,
    short_name        VARCHAR(40)  NOT NULL,
    club_type         club_type    NOT NULL,
    status            club_status  NOT NULL DEFAULT 'Active',
    town              VARCHAR(120),
    registration_date DATE         NOT NULL DEFAULT CURRENT_DATE,

    -- SDD 5.2.1 lists pool_balance on Club as derived and reconciled to the
    -- ledger. We do NOT store it. A stored balance is a second source of truth
    -- that can drift from the ledger, and the ledger is the record of account.
    -- getPoolBalance() sums the ledger. See docs/decisions.md.

    created_at        TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at        TIMESTAMPTZ  NOT NULL DEFAULT now()
);

-- Session may now reference a club.
ALTER TABLE session
    ADD CONSTRAINT session_active_club_fk
    FOREIGN KEY (active_club_id) REFERENCES club(club_id) ON DELETE SET NULL;

-- ---------------------------------------------------------------------------
-- constitution
-- ---------------------------------------------------------------------------
-- SDD 5.4: the club's operating parameters are configuration, not code. Each
-- amendment creates a NEW ROW rather than updating the existing one (REQ-30),
-- because a burial claim must be assessed against the rules in force on the
-- date of death, not the rules in force today (REQ-86). Superseding a version
-- therefore means inserting the next one, never editing the last.

CREATE TYPE cycle_frequency AS ENUM ('Weekly', 'Fortnightly', 'Monthly');

CREATE TABLE constitution (
    constitution_id     UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id             UUID            NOT NULL REFERENCES club(club_id) ON DELETE CASCADE,
    version             INTEGER         NOT NULL,
    effective_date      DATE            NOT NULL,

    contribution_amount NUMERIC(12,2)   NOT NULL CHECK (contribution_amount > 0),
    cycle_frequency     cycle_frequency NOT NULL DEFAULT 'Monthly',
    cycle_start_date    DATE            NOT NULL,
    penalty_amount      NUMERIC(12,2)   NOT NULL DEFAULT 0 CHECK (penalty_amount >= 0),
    grace_period_days   SMALLINT        NOT NULL DEFAULT 0 CHECK (grace_period_days >= 0),
    quorum_percentage   SMALLINT        NOT NULL DEFAULT 50
                                        CHECK (quorum_percentage BETWEEN 1 AND 100),
    exit_notice_days    SMALLINT        NOT NULL DEFAULT 30,
    payout_order_method VARCHAR(40),
    forfeiture_rule     TEXT,

    -- Burial societies only.
    waiting_period_days SMALLINT        NOT NULL DEFAULT 0,
    benefit_schedule    JSONB           NOT NULL DEFAULT '[]'::jsonb,

    amendment_note      TEXT,
    adopted_by          UUID REFERENCES user_account(user_id),
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT now(),

    UNIQUE (club_id, version)
);

CREATE INDEX constitution_club_idx ON constitution (club_id);

-- getVersionInForceOn(date) resolves through this index.
CREATE INDEX constitution_in_force_idx ON constitution (club_id, effective_date DESC);