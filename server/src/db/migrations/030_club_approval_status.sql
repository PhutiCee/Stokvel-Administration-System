-- Commit new enum values before using them in migration 031.
ALTER TYPE club_status ADD VALUE IF NOT EXISTS 'Pending approval';
ALTER TYPE club_status ADD VALUE IF NOT EXISTS 'Rejected';
