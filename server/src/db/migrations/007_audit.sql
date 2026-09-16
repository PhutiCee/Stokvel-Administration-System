-- 007_audit.sql
-- REQ-9 / REQ-14 / REQ-99: every authentication attempt, every session
-- termination, every refused authorisation and every financially significant
-- operation is recorded here.
--
-- club_id is NULLABLE, unlike every other tenant-scoped table: a failed login
-- happens before any club context exists, and a cross-tenant probe must be
-- recorded even though the actor had no right to the club they named.

CREATE TYPE audit_outcome AS ENUM ('Success', 'Refused', 'Failed');

CREATE TABLE audit_log (
    audit_id    BIGSERIAL     PRIMARY KEY,
    club_id     UUID          REFERENCES club(club_id) ON DELETE SET NULL,
    user_id     UUID          REFERENCES user_account(user_id) ON DELETE SET NULL,

    action      VARCHAR(80)   NOT NULL,   -- 'auth.login', 'contribution.capture'
    outcome     audit_outcome NOT NULL,
    detail      TEXT,
    target_type VARCHAR(60),
    target_id   UUID,

    ip_address  INET,
    user_agent  TEXT,
    occurred_at TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX audit_club_idx   ON audit_log (club_id, occurred_at DESC);
CREATE INDEX audit_user_idx   ON audit_log (user_id, occurred_at DESC);
CREATE INDEX audit_action_idx ON audit_log (action, occurred_at DESC);

-- The audit log is append-only for the same reason the ledger is.
CREATE OR REPLACE FUNCTION audit_is_append_only()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'audit_log is append-only: % is not permitted.', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_no_update
    BEFORE UPDATE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_is_append_only();

CREATE TRIGGER audit_no_delete
    BEFORE DELETE ON audit_log
    FOR EACH ROW EXECUTE FUNCTION audit_is_append_only();