-- 002_identity.sql
-- User accounts and sessions. These are the only two tables in the system that
-- are NOT scoped to a club (REQ-12): one natural person holds one account and
-- may belong to several clubs through it (REQ-15).

-- ---------------------------------------------------------------------------
-- user_account
-- ---------------------------------------------------------------------------
-- The phone number is the username (REQ-1). It is the identifier a stokvel
-- member actually has and remembers; email is optional and many members will
-- not have one. Stored normalised to digits only so that "082 441 7788",
-- "0824417788" and "+27824417788" all resolve to the same account.
--
-- password_hash holds a scrypt digest (REQ-2). Format is documented in
-- src/lib/password.js. No column in this schema may ever hold a recoverable
-- password.

CREATE TABLE user_account (
    user_id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    phone              VARCHAR(20)  NOT NULL UNIQUE,
    email              VARCHAR(160) UNIQUE,
    full_name          VARCHAR(120) NOT NULL,
    id_number          VARCHAR(13),
    password_hash      TEXT         NOT NULL,
    is_platform_admin  BOOLEAN      NOT NULL DEFAULT FALSE,

    -- REQ-6: five consecutive failures locks the account for 15 minutes.
    failed_attempts    SMALLINT     NOT NULL DEFAULT 0,
    locked_until       TIMESTAMPTZ,
    last_login_at      TIMESTAMPTZ,

    created_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),
    updated_at         TIMESTAMPTZ  NOT NULL DEFAULT now(),

    CONSTRAINT phone_is_digits CHECK (phone ~ '^[0-9]{9,15}$')
);

-- ---------------------------------------------------------------------------
-- session
-- ---------------------------------------------------------------------------
-- Opaque server-side sessions, not JWTs. REQ-5 requires that the server be able
-- to invalidate a token on logout; a self-contained token cannot be invalidated
-- without a revocation list, which is a session table by another name.
--
-- token_hash: we store SHA-256 of the token, never the token itself, so that a
-- leaked database dump does not hand over live sessions.
--
-- active_club_id: the club context lives on the SERVER SIDE OF THE SESSION, not
-- in a request header or request body. This is what makes REQ-13 enforceable —
-- the client cannot assert which club it is acting in, it can only ask the
-- server to switch (REQ-17), and the switch is checked against membership.

CREATE TABLE session (
    session_id      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID        NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
    token_hash      CHAR(64)    NOT NULL UNIQUE,
    active_club_id  UUID,                     -- FK added in 003 once club exists
    issued_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
    expires_at      TIMESTAMPTZ NOT NULL,     -- REQ-4: 30 minutes of inactivity
    terminated_at   TIMESTAMPTZ,              -- REQ-5: set on explicit sign-out
    ip_address      INET,
    user_agent      TEXT
);

CREATE INDEX session_user_idx    ON session (user_id);
CREATE INDEX session_expiry_idx  ON session (expires_at) WHERE terminated_at IS NULL;