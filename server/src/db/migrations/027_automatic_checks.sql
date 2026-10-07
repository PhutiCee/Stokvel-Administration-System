-- An unloginable identity distinguishes automatic assessments from officer actions.
ALTER TABLE user_account ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;
INSERT INTO user_account(user_id,phone,full_name,password_hash,is_system,postal_address)
VALUES('00000000-0000-4000-8000-000000000001','000000000000001','Automatic club rules','!login-disabled',true,'Internal automation identity');
ALTER TABLE notification ADD COLUMN member_id UUID;
ALTER TABLE notification ADD FOREIGN KEY(club_id,member_id) REFERENCES member(club_id,member_id);
ALTER TABLE notification ADD COLUMN event_key TEXT;
CREATE UNIQUE INDEX notification_event_once ON notification(club_id,event_key) WHERE event_key IS NOT NULL;
