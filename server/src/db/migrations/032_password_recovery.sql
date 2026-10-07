-- Password recovery links are stored as hashes and can be used only once.
CREATE TABLE password_reset_token (
    reset_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL REFERENCES user_account(user_id) ON DELETE CASCADE,
    token_hash CHAR(64) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at TIMESTAMPTZ,
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    request_ip INET
);

CREATE INDEX password_reset_user_recent_idx
    ON password_reset_token(user_id, requested_at DESC);
CREATE INDEX password_reset_expiry_idx
    ON password_reset_token(expires_at) WHERE used_at IS NULL;
