-- 001_extensions.sql
-- pgcrypto supplies gen_random_uuid(). SDD 5.2.2: every table uses a UUID
-- primary key.

CREATE EXTENSION IF NOT EXISTS pgcrypto;