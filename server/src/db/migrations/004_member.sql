-- 004_member.sql
-- Membership joins a user account to a club. The pair (club_id, user_id) is
-- unique: one person holds one membership per club, but may hold a DIFFERENT
-- ROLE in each club they belong to (REQ-10). The role therefore lives here, on
-- the membership, and never on user_account.

CREATE TYPE member_role     AS ENUM ('Chairperson', 'Treasurer', 'Secretary', 'Member');
CREATE TYPE member_standing AS ENUM ('Good standing', 'In arrears', 'Suspended', 'Expelled', 'Exited');

CREATE TABLE member (
    member_id       UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id         UUID            NOT NULL REFERENCES club(club_id) ON DELETE CASCADE,
    user_id         UUID            NOT NULL REFERENCES user_account(user_id) ON DELETE RESTRICT,

    role            member_role     NOT NULL DEFAULT 'Member',
    standing        member_standing NOT NULL DEFAULT 'Good standing',
    join_date       DATE            NOT NULL DEFAULT CURRENT_DATE,
    exit_date       DATE,

    -- Rotating clubs only. NULL for accumulating and burial clubs.
    queue_position  INTEGER,

    -- Set when a member joins part-way through a cycle (REQ-41).
    catch_up_amount NUMERIC(12,2)   NOT NULL DEFAULT 0,

    next_of_kin     JSONB,

    registered_by   UUID REFERENCES user_account(user_id),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT now(),

    UNIQUE (club_id, user_id),
    CONSTRAINT exit_date_after_join CHECK (exit_date IS NULL OR exit_date >= join_date)
);

CREATE INDEX member_club_idx      ON member (club_id);
CREATE INDEX member_user_idx      ON member (user_id);
CREATE INDEX member_queue_idx     ON member (club_id, queue_position)
                                   WHERE queue_position IS NOT NULL;

-- REQ-48 / BR-18: an exited member is never deleted. The row is retained so
-- that historical ledger entries continue to resolve to a name.

-- ---------------------------------------------------------------------------
-- beneficiary — who receives a member's benefit (REQ-36)
-- ---------------------------------------------------------------------------
CREATE TABLE beneficiary (
    beneficiary_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id        UUID          NOT NULL REFERENCES club(club_id) ON DELETE CASCADE,
    member_id      UUID          NOT NULL REFERENCES member(member_id) ON DELETE CASCADE,
    name           VARCHAR(120)  NOT NULL,
    relationship   VARCHAR(60),
    share_percent  NUMERIC(5,2)  NOT NULL CHECK (share_percent > 0 AND share_percent <= 100),
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX beneficiary_club_idx   ON beneficiary (club_id);
CREATE INDEX beneficiary_member_idx ON beneficiary (member_id);

-- ---------------------------------------------------------------------------
-- dependant — who is covered by a burial benefit (REQ-37, REQ-85)
-- ---------------------------------------------------------------------------
-- Distinct from beneficiary: a beneficiary RECEIVES money, a dependant is a
-- person whose death TRIGGERS a claim. They are often different people.

CREATE TABLE dependant (
    dependant_id  UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id       UUID          NOT NULL REFERENCES club(club_id) ON DELETE CASCADE,
    member_id     UUID          NOT NULL REFERENCES member(member_id) ON DELETE CASCADE,
    name          VARCHAR(120)  NOT NULL,
    category      VARCHAR(60)   NOT NULL,   -- matches constitution.benefit_schedule
    date_of_birth DATE,
    registered_at DATE          NOT NULL DEFAULT CURRENT_DATE,
    removed_at    DATE,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX dependant_club_idx   ON dependant (club_id);
CREATE INDEX dependant_member_idx ON dependant (member_id);