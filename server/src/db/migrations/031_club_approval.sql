-- Existing clubs retain their status. Only Chairperson applications are pending.
ALTER TABLE club
  ADD COLUMN requested_by UUID REFERENCES user_account(user_id),
  ADD COLUMN reviewed_by UUID REFERENCES user_account(user_id),
  ADD COLUMN reviewed_at TIMESTAMPTZ,
  ADD COLUMN rejection_reason TEXT,
  ADD CONSTRAINT club_review_fields CHECK (
    (reviewed_by IS NULL AND reviewed_at IS NULL) OR
    (reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL)
  ),
  ADD CONSTRAINT rejected_club_reason CHECK (
    status <> 'Rejected' OR (reviewed_by IS NOT NULL AND length(trim(rejection_reason)) > 0)
  );
CREATE INDEX club_pending_approval_idx ON club(created_at) WHERE status='Pending approval';
