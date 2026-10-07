ALTER TABLE reconciliation ADD COLUMN contributions_captured NUMERIC(12,2);
CREATE TABLE reconciliation_resolution (
 club_id UUID NOT NULL REFERENCES club(club_id),
 reconciliation_id UUID PRIMARY KEY REFERENCES reconciliation(reconciliation_id),
 explanation TEXT NOT NULL CHECK(length(btrim(explanation)) BETWEEN 3 AND 2000),
 resolved_by UUID NOT NULL REFERENCES user_account(user_id), resolved_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE reconciliation_resolution_entry (
 club_id UUID NOT NULL REFERENCES club(club_id),
 reconciliation_id UUID NOT NULL REFERENCES reconciliation_resolution(reconciliation_id),
 entry_id UUID NOT NULL UNIQUE REFERENCES ledger_entry(entry_id),
 PRIMARY KEY(reconciliation_id,entry_id)
);
CREATE TRIGGER reconciliation_resolution_immutable BEFORE UPDATE OR DELETE ON reconciliation_resolution FOR EACH ROW EXECUTE FUNCTION completion_immutable();
CREATE TRIGGER reconciliation_resolution_entry_immutable BEFORE UPDATE OR DELETE ON reconciliation_resolution_entry FOR EACH ROW EXECUTE FUNCTION completion_immutable();
