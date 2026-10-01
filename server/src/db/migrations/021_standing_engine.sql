-- 021_standing_engine.sql
-- REQ-44, REQ-101 to REQ-103.
--
-- Nothing in the application changed a member's standing; only the seed script
-- set it. This adds what the standing engine needs.

-- ---------------------------------------------------------------------------
-- 1. Thresholds, in missed contributions, on the constitution.
--
--    The constitution is versioned and immutable (migration 010), so these
--    columns are NULL on every existing version. NULL means "this club has not
--    set standing thresholds" and the engine leaves its members alone. A club
--    sets them by recording an amendment.
-- ---------------------------------------------------------------------------
ALTER TABLE constitution
    ADD COLUMN warning_after_missed    INTEGER CHECK (warning_after_missed    IS NULL OR warning_after_missed    >= 1),
    ADD COLUMN suspension_after_missed INTEGER CHECK (suspension_after_missed IS NULL OR suspension_after_missed >= 1),
    ADD COLUMN expulsion_after_missed  INTEGER CHECK (expulsion_after_missed  IS NULL OR expulsion_after_missed  >= 1);

-- All three or none, and increasing (mirrors validateConsistency).
ALTER TABLE constitution ADD CONSTRAINT constitution_standing_thresholds_coherent CHECK (
    (warning_after_missed IS NULL
        AND suspension_after_missed IS NULL
        AND expulsion_after_missed IS NULL)
    OR
    (warning_after_missed IS NOT NULL
        AND suspension_after_missed IS NOT NULL
        AND expulsion_after_missed IS NOT NULL
        AND warning_after_missed < suspension_after_missed
        AND suspension_after_missed < expulsion_after_missed)
);

-- ---------------------------------------------------------------------------
-- 2. A record of every change of standing, with its date (REQ-103).
--
--    changed_by is NULL when the engine made the change on its own.
--    Append-only, like the ledger: a change of standing that happened is not
--    edited afterwards.
-- ---------------------------------------------------------------------------
CREATE TABLE standing_change (
    change_id     UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id       UUID            NOT NULL REFERENCES club(club_id)     ON DELETE RESTRICT,
    member_id     UUID            NOT NULL REFERENCES member(member_id) ON DELETE RESTRICT,

    from_standing member_standing NOT NULL,
    to_standing   member_standing NOT NULL,
    reason        TEXT            NOT NULL,
    changed_on    DATE            NOT NULL,

    changed_by    UUID REFERENCES user_account(user_id),
    created_at    TIMESTAMPTZ     NOT NULL DEFAULT now(),

    CONSTRAINT standing_actually_changed CHECK (from_standing <> to_standing)
);

CREATE INDEX standing_change_club_idx   ON standing_change (club_id);
CREATE INDEX standing_change_member_idx ON standing_change (member_id, created_at);

CREATE OR REPLACE FUNCTION standing_change_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'standing_change is append-only: % is not permitted.', TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER standing_change_no_update
    BEFORE UPDATE ON standing_change
    FOR EACH ROW EXECUTE FUNCTION standing_change_is_immutable();

CREATE TRIGGER standing_change_no_delete
    BEFORE DELETE ON standing_change
    FOR EACH ROW EXECUTE FUNCTION standing_change_is_immutable();