-- 015_proof_of_payment.sql
-- REQ-51 to REQ-53.
--
-- One file per contribution, stored as bytes in the same database as
-- everything else. A real production deployment would put this in object
-- storage (S3 or similar) and keep only a reference here; this project has no
-- such service or credentials configured, and REQ-53's own limit (5 MB, JPEG,
-- PNG or PDF only) keeps a database-stored file small and bounded enough that
-- the simpler approach does not cost much. See decisions.md.
--
-- Not made immutable like the ledger or a payout: this is supporting evidence,
-- not a financial record, and a Treasurer legitimately needs to replace a
-- blurry photo with a clearer one. Uploading again for the same contribution
-- replaces what was there.

CREATE TABLE proof_of_payment (
    proof_id           UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id            UUID        NOT NULL REFERENCES club(club_id)               ON DELETE RESTRICT,
    contribution_id    UUID        NOT NULL UNIQUE REFERENCES contribution(contribution_id) ON DELETE CASCADE,

    file_data          BYTEA       NOT NULL,
    mime_type          TEXT        NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'application/pdf')),
    original_filename  TEXT        NOT NULL,
    file_size          INTEGER     NOT NULL CHECK (file_size > 0 AND file_size <= 5242880), -- REQ-53: 5 MB

    uploaded_by        UUID        NOT NULL REFERENCES user_account(user_id),
    uploaded_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX proof_of_payment_club_idx ON proof_of_payment (club_id);