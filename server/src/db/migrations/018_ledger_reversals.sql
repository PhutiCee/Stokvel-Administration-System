-- REQ-91/92. Approval is attached to one immutable request and exact original.
CREATE TABLE ledger_reversal_request (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NOT NULL REFERENCES club(club_id),
    entry_id UUID NOT NULL REFERENCES ledger_entry(entry_id),
    reason TEXT NOT NULL CHECK (length(btrim(reason)) BETWEEN 3 AND 2000),
    requested_by UUID NOT NULL REFERENCES user_account(user_id),
    requested_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    status TEXT NOT NULL CHECK (status IN ('Pending','Approved','Rejected','Posted')),
    decided_by UUID REFERENCES user_account(user_id),
    decided_at TIMESTAMPTZ,
    decision_reason TEXT,
    posted_entry_id UUID UNIQUE REFERENCES ledger_entry(entry_id),
    posted_by UUID REFERENCES user_account(user_id),
    posted_at TIMESTAMPTZ
);
CREATE UNIQUE INDEX reversal_request_one_live ON ledger_reversal_request(club_id,entry_id)
WHERE status <> 'Rejected';

CREATE FUNCTION reversal_request_guard() RETURNS TRIGGER AS $$
DECLARE original ledger_entry%ROWTYPE; reversal ledger_entry%ROWTYPE;
BEGIN
    IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Reversal requests cannot be deleted.'; END IF;
    SELECT * INTO original FROM ledger_entry WHERE entry_id=NEW.entry_id AND club_id=NEW.club_id;
    IF NOT FOUND OR original.reverses_id IS NOT NULL OR original.entry_type='Reversal' THEN
        RAISE EXCEPTION 'The original must be an unreversed entry in this club.';
    END IF;
    IF TG_OP='INSERT' THEN
        IF NEW.status<>'Pending' OR NEW.decided_by IS NOT NULL OR NEW.decided_at IS NOT NULL OR NEW.decision_reason IS NOT NULL OR NEW.posted_entry_id IS NOT NULL OR NEW.posted_by IS NOT NULL OR NEW.posted_at IS NOT NULL THEN
            RAISE EXCEPTION 'New requests start pending.';
        END IF;
    ELSE
        IF (NEW.request_id,NEW.club_id,NEW.entry_id,NEW.reason,NEW.requested_by,NEW.requested_at)
          IS DISTINCT FROM (OLD.request_id,OLD.club_id,OLD.entry_id,OLD.reason,OLD.requested_by,OLD.requested_at) THEN
            RAISE EXCEPTION 'The requested entry and reason cannot be edited.';
        END IF;
        IF OLD.status IN ('Posted','Rejected') THEN RAISE EXCEPTION 'This decision is final.'; END IF;
        IF NEW.status IN ('Approved','Rejected') AND OLD.status='Pending' THEN
            IF NEW.posted_entry_id IS NOT NULL OR NEW.posted_by IS NOT NULL OR NEW.posted_at IS NOT NULL OR NEW.decided_by IS NULL OR NEW.decided_at IS NULL OR NEW.decided_by=NEW.requested_by OR
               NOT EXISTS(SELECT 1 FROM member WHERE club_id=NEW.club_id AND user_id=NEW.decided_by
                 AND role='Chairperson' AND standing NOT IN ('Exited','Expelled')) THEN
                RAISE EXCEPTION 'A different current Chairperson must decide.';
            END IF;
            IF NEW.status='Rejected' AND length(btrim(coalesce(NEW.decision_reason,'')))<3 THEN
                RAISE EXCEPTION 'A rejection needs a reason.';
            END IF;
        ELSIF NEW.status='Posted' AND (OLD.status='Approved' OR (OLD.status='Pending' AND original.entry_type NOT IN ('Payout','Claim'))) THEN
            IF (NEW.decided_by,NEW.decided_at,NEW.decision_reason) IS DISTINCT FROM (OLD.decided_by,OLD.decided_at,OLD.decision_reason) THEN
                RAISE EXCEPTION 'Approval cannot be replaced when posting.';
            END IF;
            SELECT * INTO reversal FROM ledger_entry WHERE entry_id=NEW.posted_entry_id AND club_id=NEW.club_id;
            IF NOT FOUND OR reversal.reverses_id IS DISTINCT FROM NEW.entry_id OR reversal.reason IS DISTINCT FROM NEW.reason OR
                NEW.posted_by IS DISTINCT FROM reversal.posted_by OR NEW.posted_at IS NULL THEN
                RAISE EXCEPTION 'A posted request must name its matching reversal.';
            END IF;
        ELSE RAISE EXCEPTION 'Invalid reversal request transition.';
        END IF;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER reversal_request_guard BEFORE INSERT OR UPDATE OR DELETE ON ledger_reversal_request
FOR EACH ROW EXECUTE FUNCTION reversal_request_guard();

-- Applies to NEW reversals only; never modifies historical ledger rows.
CREATE FUNCTION ledger_reversal_guard() RETURNS TRIGGER AS $$
DECLARE original ledger_entry%ROWTYPE;
BEGIN
    IF NEW.entry_type='Reversal' OR NEW.reverses_id IS NOT NULL THEN
        SELECT * INTO original FROM ledger_entry WHERE entry_id=NEW.reverses_id AND club_id=NEW.club_id;
        IF NOT FOUND OR NEW.entry_type<>'Reversal' OR original.entry_type='Reversal' OR original.reverses_id IS NOT NULL
          OR NEW.amount<>-original.amount OR NEW.member_id IS DISTINCT FROM original.member_id
          OR NEW.contribution_id IS DISTINCT FROM original.contribution_id
          OR NEW.penalty_id IS DISTINCT FROM original.penalty_id
          OR length(btrim(coalesce(NEW.reason,'')))<1 THEN
            RAISE EXCEPTION 'A reversal must exactly oppose and reference the original in this club, with a reason.';
        END IF;
        IF original.entry_type IN ('Payout','Claim') AND NOT EXISTS (
            SELECT 1 FROM ledger_reversal_request r JOIN member m ON m.club_id=r.club_id AND m.user_id=NEW.posted_by
            WHERE r.club_id=NEW.club_id AND r.entry_id=original.entry_id AND r.status='Approved' AND r.reason=NEW.reason
              AND r.decided_by<>NEW.posted_by AND m.role='Treasurer' AND m.standing NOT IN ('Exited','Expelled')
        ) THEN RAISE EXCEPTION 'Payout reversals require prior Chairperson approval and Treasurer posting.'; END IF;
    END IF;
    RETURN NEW;
END; $$ LANGUAGE plpgsql;
CREATE TRIGGER ledger_reversal_guard BEFORE INSERT ON ledger_entry FOR EACH ROW EXECUTE FUNCTION ledger_reversal_guard();
