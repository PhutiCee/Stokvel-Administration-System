-- An allocation cannot be appended to a previously balanced immutable receipt.
CREATE CONSTRAINT TRIGGER allocation_total_guard AFTER INSERT ON receipt_allocation
DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION receipt_total_guard();

CREATE FUNCTION payout_effect_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS (
   SELECT 1 FROM payout p JOIN ledger_entry e ON e.payout_id=p.payout_id AND e.club_id=p.club_id
   WHERE p.club_id=NEW.club_id AND p.payout_id=NEW.payout_id AND e.entry_id=NEW.entry_id
     AND p.status='Approved' AND e.amount=-p.amount AND e.member_id=p.member_id
     AND ((p.payout_type='Rotation' AND e.entry_type='Payout') OR (p.payout_type='Burial claim' AND e.entry_type IN ('Payout','Claim')))
 ) THEN RAISE EXCEPTION 'Payout effect must match its approved source and club'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER payout_effect_source_guard BEFORE INSERT ON payout_effect
FOR EACH ROW EXECUTE FUNCTION payout_effect_source_guard();

CREATE FUNCTION reversal_payout_source_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.reverses_id IS NOT NULL AND NEW.payout_id IS DISTINCT FROM
 (SELECT payout_id FROM ledger_entry WHERE entry_id=NEW.reverses_id AND club_id=NEW.club_id)
 THEN RAISE EXCEPTION 'Reversal must preserve the original payout link'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER reversal_payout_source_guard BEFORE INSERT ON ledger_entry
FOR EACH ROW EXECUTE FUNCTION reversal_payout_source_guard();
