-- Preserve original assessment amounts and posted running balances.
-- A penalty assessment (and its waiver) is not a cash receipt or payment.
-- New entries preserve both balances; legacy rows retain NULL in this new field.
ALTER TABLE ledger_entry ADD COLUMN cash_resulting_balance NUMERIC(12,2);
CREATE VIEW cash_ledger_entry AS
SELECT e.*,
       CASE WHEN coalesce(o.entry_type,e.entry_type)='Penalty'
            THEN 0::numeric(12,2) ELSE e.amount END AS cash_amount
FROM ledger_entry e
LEFT JOIN ledger_entry o ON o.club_id=e.club_id AND o.entry_id=e.reverses_id;

ALTER TABLE cycle ADD COLUMN closed_by UUID REFERENCES user_account(user_id);
CREATE FUNCTION cycle_closure_is_final() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status='Closed' AND (NEW.status IS DISTINCT FROM OLD.status
      OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
      OR NEW.closed_by IS DISTINCT FROM OLD.closed_by) THEN
    RAISE EXCEPTION 'A closed cycle retains its closure record; correct receipts through reversals';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER cycle_closure_final BEFORE UPDATE ON cycle
FOR EACH ROW EXECUTE FUNCTION cycle_closure_is_final();
