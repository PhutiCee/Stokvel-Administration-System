-- 010_constitution_versioning.sql
-- REQ-30, REQ-31, REQ-33.
--
-- Migration 003 keeps every constitution version as its own row, but nothing
-- in the database stopped a row being edited or deleted, or a version being
-- inserted out of order. The application has no code path that does either, so
-- REQ-30 held only as long as nobody wrote one. The ledger does not rely on
-- that (migration 006), and the constitution should not either: a payout or a
-- burial claim is assessed against the version in force on a date, so a
-- version that can be quietly altered changes the answer to a question that was
-- already settled.

-- ---------------------------------------------------------------------------
-- A recorded version can be neither edited nor removed.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION constitution_is_immutable()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION
        'constitution is versioned: % is not permitted. Record an amendment as a new version instead (REQ-30).',
        TG_OP
        USING ERRCODE = 'restrict_violation';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER constitution_no_update
    BEFORE UPDATE ON constitution
    FOR EACH ROW EXECUTE FUNCTION constitution_is_immutable();

CREATE TRIGGER constitution_no_delete
    BEFORE DELETE ON constitution
    FOR EACH ROW EXECUTE FUNCTION constitution_is_immutable();

-- ---------------------------------------------------------------------------
-- Versions are numbered consecutively and take effect in order.
-- ---------------------------------------------------------------------------
-- If version 3 could take effect before version 2, then on the dates between
-- them the constitution "in force" would be version 2 even though version 3 was
-- adopted later. Requiring the effective date to move forward with the version
-- number removes that ambiguity for every reader of the table.
--
-- The rule that an amendment may not take effect in the past (REQ-33) is NOT
-- enforced here. It is a business rule about new amendments, and the seed data
-- and any migration of historical records legitimately insert past dates. It
-- is enforced in rules/versioning.js.
CREATE OR REPLACE FUNCTION constitution_check_new_version()
RETURNS TRIGGER AS $$
DECLARE
    latest RECORD;
BEGIN
    SELECT version, effective_date INTO latest
      FROM constitution
     WHERE club_id = NEW.club_id
     ORDER BY version DESC
     LIMIT 1;

    IF NOT FOUND THEN
        IF NEW.version <> 1 THEN
            RAISE EXCEPTION
                'The first constitution version of a club must be version 1, not %.', NEW.version
                USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;

    IF NEW.version <> latest.version + 1 THEN
        RAISE EXCEPTION
            'Constitution versions are numbered consecutively. Version % is recorded, so the next is %, not %.',
            latest.version, latest.version + 1, NEW.version
            USING ERRCODE = 'check_violation';
    END IF;

    IF NEW.effective_date <= latest.effective_date THEN
        RAISE EXCEPTION
            'Version % takes effect on %. Version % must take effect after it, not on %.',
            latest.version, latest.effective_date, NEW.version, NEW.effective_date
            USING ERRCODE = 'check_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER constitution_version_order
    BEFORE INSERT ON constitution
    FOR EACH ROW EXECUTE FUNCTION constitution_check_new_version();