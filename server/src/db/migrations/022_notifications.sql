-- 016_notifications.sql
--
-- Club notifications. The Secretary (or Chairperson, who shares the Secretary's
-- governance-record permission) broadcasts a message to the whole club; every
-- member sees it, regardless of role. There is no per-member routing and no
-- rule engine involved — this is announcement, not money, so it carries none
-- of the immutability or waterfall logic the financial tables do.

CREATE TABLE notification (
    notification_id UUID          PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id         UUID          NOT NULL REFERENCES club(club_id) ON DELETE CASCADE,
    sent_by         UUID          NOT NULL REFERENCES user_account(user_id),
    title           VARCHAR(120)  NOT NULL,
    message         TEXT          NOT NULL,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT now()
);

CREATE INDEX notification_club_idx ON notification (club_id, created_at DESC);
