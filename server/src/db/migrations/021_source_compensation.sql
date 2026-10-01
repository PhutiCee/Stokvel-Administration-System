-- Receipt allocations are evidence, never reconstructed from aggregate balances.
CREATE TABLE capture_receipt (
 entry_id UUID PRIMARY KEY REFERENCES ledger_entry(entry_id),
 club_id UUID NOT NULL REFERENCES club(club_id),
 contribution_id UUID NOT NULL REFERENCES contribution(contribution_id),
 receipt_date DATE NOT NULL, method payment_method NOT NULL, reference TEXT,
 corrects_entry_id UUID UNIQUE REFERENCES ledger_entry(entry_id),
 UNIQUE(club_id,entry_id)
);
CREATE TABLE receipt_allocation (
 allocation_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id UUID NOT NULL REFERENCES club(club_id),
 entry_id UUID NOT NULL REFERENCES capture_receipt(entry_id),
 kind TEXT NOT NULL CHECK(kind IN ('contribution','penalty','credit')),
 target_id UUID NOT NULL, amount NUMERIC(12,2) NOT NULL CHECK(amount>0),
 UNIQUE(club_id,allocation_id)
);
CREATE TABLE credit_application (
 application_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
 club_id UUID NOT NULL REFERENCES club(club_id),
 allocation_id UUID NOT NULL REFERENCES receipt_allocation(allocation_id),
 contribution_id UUID NOT NULL REFERENCES contribution(contribution_id),
 amount NUMERIC(12,2) NOT NULL CHECK(amount>0),
 created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE payout_effect (
 entry_id UUID PRIMARY KEY REFERENCES ledger_entry(entry_id),
 club_id UUID NOT NULL REFERENCES club(club_id),
 payout_id UUID NOT NULL UNIQUE REFERENCES payout(payout_id),
 queue_before JSONB, queue_after JSONB
);
CREATE TRIGGER capture_receipt_immutable BEFORE UPDATE OR DELETE ON capture_receipt FOR EACH ROW EXECUTE FUNCTION completion_immutable();
CREATE TRIGGER receipt_allocation_immutable BEFORE UPDATE OR DELETE ON receipt_allocation FOR EACH ROW EXECUTE FUNCTION completion_immutable();
CREATE TRIGGER credit_application_immutable BEFORE UPDATE OR DELETE ON credit_application FOR EACH ROW EXECUTE FUNCTION completion_immutable();
CREATE TRIGGER payout_effect_immutable BEFORE UPDATE OR DELETE ON payout_effect FOR EACH ROW EXECUTE FUNCTION completion_immutable();
CREATE FUNCTION allocation_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE e ledger_entry%ROWTYPE; c contribution%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='capture_receipt' THEN
  SELECT * INTO e FROM ledger_entry WHERE entry_id=NEW.entry_id AND club_id=NEW.club_id;
  SELECT * INTO c FROM contribution WHERE contribution_id=NEW.contribution_id AND club_id=NEW.club_id;
  IF e.entry_type IS DISTINCT FROM 'Contribution' OR c.member_id IS DISTINCT FROM e.member_id OR e.contribution_id IS DISTINCT FROM c.contribution_id THEN RAISE EXCEPTION 'Receipt must match its contribution and club'; END IF;
  IF NEW.corrects_entry_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM ledger_entry o JOIN ledger_entry r ON r.reverses_id=o.entry_id AND r.club_id=o.club_id WHERE o.club_id=NEW.club_id AND o.entry_id=NEW.corrects_entry_id AND o.contribution_id=NEW.contribution_id) THEN RAISE EXCEPTION 'Correction requires a reversed receipt for this contribution'; END IF;
 ELSIF TG_TABLE_NAME='receipt_allocation' THEN
  SELECT e0.* INTO e FROM ledger_entry e0 JOIN capture_receipt r ON r.entry_id=e0.entry_id AND r.club_id=e0.club_id WHERE e0.club_id=NEW.club_id AND e0.entry_id=NEW.entry_id;
  IF NOT FOUND OR (NEW.kind='contribution' AND NOT EXISTS(SELECT 1 FROM contribution WHERE club_id=NEW.club_id AND contribution_id=NEW.target_id AND member_id=e.member_id)) OR (NEW.kind='penalty' AND NOT EXISTS(SELECT 1 FROM penalty WHERE club_id=NEW.club_id AND penalty_id=NEW.target_id AND member_id=e.member_id)) OR (NEW.kind='credit' AND NEW.target_id IS DISTINCT FROM e.member_id) THEN RAISE EXCEPTION 'Allocation must belong to the receipt member and club'; END IF;
 ELSIF TG_TABLE_NAME='credit_application' THEN
  IF NOT EXISTS(SELECT 1 FROM receipt_allocation a JOIN contribution ct ON ct.club_id=a.club_id AND ct.member_id=a.target_id WHERE a.club_id=NEW.club_id AND a.allocation_id=NEW.allocation_id AND a.kind='credit' AND ct.contribution_id=NEW.contribution_id) THEN RAISE EXCEPTION 'Credit application must belong to the member and club'; END IF;
  IF NEW.amount+(SELECT coalesce(sum(amount),0) FROM credit_application WHERE club_id=NEW.club_id AND allocation_id=NEW.allocation_id)>(SELECT amount FROM receipt_allocation WHERE club_id=NEW.club_id AND allocation_id=NEW.allocation_id) THEN RAISE EXCEPTION 'Credit application exceeds original credit'; END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER capture_receipt_guard BEFORE INSERT ON capture_receipt FOR EACH ROW EXECUTE FUNCTION allocation_guard();
CREATE TRIGGER receipt_allocation_guard BEFORE INSERT ON receipt_allocation FOR EACH ROW EXECUTE FUNCTION allocation_guard();
CREATE TRIGGER credit_application_guard BEFORE INSERT ON credit_application FOR EACH ROW EXECUTE FUNCTION allocation_guard();
CREATE FUNCTION receipt_total_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF (SELECT amount FROM ledger_entry WHERE club_id=NEW.club_id AND entry_id=NEW.entry_id) IS DISTINCT FROM (SELECT coalesce(sum(amount),0) FROM receipt_allocation WHERE club_id=NEW.club_id AND entry_id=NEW.entry_id) THEN RAISE EXCEPTION 'Receipt allocations must reconcile exactly'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER receipt_total_guard AFTER INSERT ON capture_receipt DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION receipt_total_guard();
ALTER TABLE payout ADD COLUMN reversed_entry_id UUID UNIQUE REFERENCES ledger_entry(entry_id);
DROP INDEX payout_one_per_cycle;
CREATE UNIQUE INDEX payout_one_per_cycle ON payout(club_id,cycle_id) WHERE payout_type='Rotation' AND status<>'Cancelled' AND reversed_entry_id IS NULL;
DROP INDEX payout_one_per_claim;
CREATE UNIQUE INDEX payout_one_per_claim ON payout(claim_id) WHERE claim_id IS NOT NULL AND status<>'Cancelled' AND reversed_entry_id IS NULL;

CREATE OR REPLACE FUNCTION payout_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP='UPDATE' AND NEW.reversed_entry_id IS DISTINCT FROM OLD.reversed_entry_id THEN
        IF OLD.status<>'Approved' OR OLD.reversed_entry_id IS NOT NULL OR
          (to_jsonb(NEW)-'reversed_entry_id') IS DISTINCT FROM (to_jsonb(OLD)-'reversed_entry_id') OR
          NOT EXISTS(SELECT 1 FROM ledger_entry r JOIN ledger_entry o ON o.entry_id=r.reverses_id AND o.club_id=r.club_id WHERE r.club_id=NEW.club_id AND r.entry_id=NEW.reversed_entry_id AND o.payout_id=NEW.payout_id)
        THEN RAISE EXCEPTION 'Only a matching reversal can mark an approved payout reversed'; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'payout records cannot be deleted. Cancel the payout instead (REQ-70).'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.status <> 'Initiated' THEN
        RAISE EXCEPTION 'payout % is % and can no longer be changed.', OLD.payout_id, OLD.status
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.status = 'Initiated' THEN
        RAISE EXCEPTION 'an Initiated payout may only be approved or cancelled.'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.club_id                  IS DISTINCT FROM OLD.club_id
    OR NEW.member_id                IS DISTINCT FROM OLD.member_id
    OR NEW.payout_type              IS DISTINCT FROM OLD.payout_type
    OR NEW.amount                   IS DISTINCT FROM OLD.amount
    OR NEW.cycle_id                 IS DISTINCT FROM OLD.cycle_id
    OR NEW.distribution_id          IS DISTINCT FROM OLD.distribution_id
    OR NEW.claim_id                 IS DISTINCT FROM OLD.claim_id
    OR NEW.constitution_version     IS DISTINCT FROM OLD.constitution_version
    OR NEW.eligibility_rule_applied IS DISTINCT FROM OLD.eligibility_rule_applied
    OR NEW.assessment_at_initiation IS DISTINCT FROM OLD.assessment_at_initiation
    OR NEW.arrears_decision_id      IS DISTINCT FROM OLD.arrears_decision_id
    OR NEW.initiated_by             IS DISTINCT FROM OLD.initiated_by
    OR NEW.initiated_at             IS DISTINCT FROM OLD.initiated_at THEN
        RAISE EXCEPTION 'what a payout was initiated for cannot be altered (REQ-68).'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE OR REPLACE FUNCTION claim_guard()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP='UPDATE' AND OLD.status='Approved' AND NEW.status='Lodged' THEN
        IF (to_jsonb(NEW)-ARRAY['status','initiated_by','initiated_at','approved_by','approved_at']) IS DISTINCT FROM (to_jsonb(OLD)-ARRAY['status','initiated_by','initiated_at','approved_by','approved_at']) OR NEW.initiated_by IS NOT NULL OR NEW.initiated_at IS NOT NULL OR NEW.approved_by IS NOT NULL OR NEW.approved_at IS NOT NULL OR
        NOT EXISTS(SELECT 1 FROM payout p WHERE p.club_id=OLD.club_id AND p.claim_id=OLD.claim_id AND p.approved_at=OLD.approved_at AND p.reversed_entry_id IS NOT NULL) OR
        EXISTS(SELECT 1 FROM payout p WHERE p.club_id=OLD.club_id AND p.claim_id=OLD.claim_id AND p.status<>'Cancelled' AND p.reversed_entry_id IS NULL)
        THEN RAISE EXCEPTION 'Reopening a claim requires its completed payout reversal'; END IF;
        RETURN NEW;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RAISE EXCEPTION 'a claim record cannot be deleted. Cancel it instead (REQ-70).'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.status = 'Approved' OR OLD.status = 'Cancelled' THEN
        RAISE EXCEPTION 'claim % is % and can no longer be changed.', OLD.claim_id, OLD.status
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF OLD.status = 'Lodged' AND NEW.status NOT IN ('Initiated', 'Cancelled') THEN
        RAISE EXCEPTION 'a Lodged claim may only be initiated for payment or cancelled.'
            USING ERRCODE = 'restrict_violation';
    END IF;
    IF OLD.status = 'Initiated' AND NEW.status NOT IN ('Approved', 'Cancelled') THEN
        RAISE EXCEPTION 'an Initiated claim may only be approved or cancelled.'
            USING ERRCODE = 'restrict_violation';
    END IF;

    IF NEW.club_id               IS DISTINCT FROM OLD.club_id
    OR NEW.member_id              IS DISTINCT FROM OLD.member_id
    OR NEW.dependant_id           IS DISTINCT FROM OLD.dependant_id
    OR NEW.date_of_death          IS DISTINCT FROM OLD.date_of_death
    OR NEW.constitution_version   IS DISTINCT FROM OLD.constitution_version
    OR NEW.dependant_category     IS DISTINCT FROM OLD.dependant_category
    OR NEW.benefit_amount         IS DISTINCT FROM OLD.benefit_amount
    OR NEW.lodged_by              IS DISTINCT FROM OLD.lodged_by
    OR NEW.lodged_at              IS DISTINCT FROM OLD.lodged_at THEN
        RAISE EXCEPTION 'what a claim was lodged for cannot be altered (REQ-86).'
            USING ERRCODE = 'restrict_violation';
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

ALTER TABLE exit_notice ADD COLUMN condition_facts JSONB;
CREATE FUNCTION exit_condition_facts_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.condition_facts IS DISTINCT FROM OLD.condition_facts THEN RAISE EXCEPTION 'Notice-date condition evidence is immutable'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER exit_condition_facts_guard BEFORE UPDATE ON exit_notice FOR EACH ROW EXECUTE FUNCTION exit_condition_facts_guard();
