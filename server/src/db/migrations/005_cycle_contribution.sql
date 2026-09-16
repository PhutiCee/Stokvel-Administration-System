-- 005_cycle_contribution.sql
-- Contribution cycles and the payments captured against them.

CREATE TYPE cycle_status        AS ENUM ('Open', 'Closed');
CREATE TYPE contribution_status AS ENUM ('Outstanding', 'Partial', 'Paid', 'Late');
CREATE TYPE payment_method      AS ENUM ('Cash', 'Electronic funds transfer', 'Debit order');

CREATE TABLE cycle (
    cycle_id        UUID         PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id         UUID         NOT NULL REFERENCES club(club_id) ON DELETE CASCADE,
    sequence_number INTEGER      NOT NULL,
    start_date      DATE         NOT NULL,
    due_date        DATE         NOT NULL,
    status          cycle_status NOT NULL DEFAULT 'Open',
    opened_by       UUID REFERENCES user_account(user_id),
    closed_at       TIMESTAMPTZ,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT now(),

    UNIQUE (club_id, sequence_number),
    CONSTRAINT due_after_start CHECK (due_date >= start_date)
);

CREATE INDEX cycle_club_idx ON cycle (club_id);

-- At most one open cycle per club. Enforced in the database rather than in the
-- service, so that two treasurers pressing "open cycle" at the same moment
-- cannot both succeed.
CREATE UNIQUE INDEX cycle_one_open_per_club ON cycle (club_id) WHERE status = 'Open';

-- ---------------------------------------------------------------------------
-- contribution
-- ---------------------------------------------------------------------------
-- One row per member per cycle, created up front by generateExpectedContributions()
-- (REQ-50). The row exists from the moment the cycle opens, with
-- captured_amount = 0 and status 'Outstanding'. Capturing a payment updates
-- this row; it never inserts a new one.

CREATE TABLE contribution (
    contribution_id UUID                PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id         UUID                NOT NULL REFERENCES club(club_id) ON DELETE CASCADE,
    cycle_id        UUID                NOT NULL REFERENCES cycle(cycle_id) ON DELETE CASCADE,
    member_id       UUID                NOT NULL REFERENCES member(member_id) ON DELETE RESTRICT,

    expected_amount NUMERIC(12,2)       NOT NULL CHECK (expected_amount >= 0),
    captured_amount NUMERIC(12,2)       NOT NULL DEFAULT 0 CHECK (captured_amount >= 0),
    status          contribution_status NOT NULL DEFAULT 'Outstanding',

    receipt_date    DATE,
    method          payment_method,
    reference       VARCHAR(80),
    proof_url       TEXT,                -- SDD 5.3: object storage reference
    captured_by     UUID REFERENCES user_account(user_id),
    captured_at     TIMESTAMPTZ,

    created_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ         NOT NULL DEFAULT now(),

    UNIQUE (cycle_id, member_id)
);

CREATE INDEX contribution_club_idx   ON contribution (club_id);
CREATE INDEX contribution_cycle_idx  ON contribution (cycle_id);
CREATE INDEX contribution_member_idx ON contribution (member_id);

-- ---------------------------------------------------------------------------
-- penalty (REQ-56, REQ-63)
-- ---------------------------------------------------------------------------
CREATE TABLE penalty (
    penalty_id    UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id       UUID          NOT NULL REFERENCES club(club_id) ON DELETE CASCADE,
    member_id     UUID          NOT NULL REFERENCES member(member_id) ON DELETE RESTRICT,
    cycle_id      UUID          REFERENCES cycle(cycle_id) ON DELETE SET NULL,
    amount        NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reason        TEXT          NOT NULL,
    levied_at     TIMESTAMPTZ   NOT NULL DEFAULT now(),
    settled_amount NUMERIC(12,2) NOT NULL DEFAULT 0,
    waived_at     TIMESTAMPTZ,
    waived_by     UUID REFERENCES user_account(user_id),
    waiver_reason TEXT
);

CREATE INDEX penalty_club_idx   ON penalty (club_id);
CREATE INDEX penalty_member_idx ON penalty (member_id);