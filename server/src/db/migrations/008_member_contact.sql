-- 008_member_contact.sql
--
-- REQ-34 requires a full name, an identity number, at least one telephone
-- number, and AT LEAST ONE OF an electronic mail address OR A POSTAL ADDRESS.
--
-- The original identity table carried no postal address, which meant a member
-- with no email could not be registered in a way that satisfied the
-- requirement. Rural burial-society members are exactly the people most likely
-- to have a postal address and no inbox, so this is not a hypothetical gap.
--
-- Added as a new migration rather than by editing 002, because 002 has already
-- been applied. A migration that has run on anybody else's machine is history,
-- and history is appended to, not rewritten — the same rule the ledger follows.

ALTER TABLE user_account
    ADD COLUMN postal_address TEXT;

-- The requirement is a disjunction, so it is expressed as one.
ALTER TABLE user_account
    ADD CONSTRAINT contact_channel_present
    CHECK (
        (email IS NOT NULL AND email <> '')
        OR (postal_address IS NOT NULL AND postal_address <> '')
    )
    NOT VALID;

-- NOT VALID means the constraint binds every future insert and update but does
-- not reject rows that already exist. Seeded accounts created before this
-- migration keep working; nothing new can be created without a contact channel.
-- Run VALIDATE CONSTRAINT once the existing rows have been backfilled.