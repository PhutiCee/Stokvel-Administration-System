-- REQ-47: exact, resolution-authorised debt forgiveness as part of an exit.
ALTER TABLE contribution ADD COLUMN written_off_amount NUMERIC(12,2) NOT NULL DEFAULT 0
 CHECK(written_off_amount>=0 AND written_off_amount<=greatest(expected_amount-captured_amount,0));
ALTER TABLE contribution ADD CONSTRAINT contribution_club_identity UNIQUE(club_id,contribution_id);
ALTER TABLE resolution ADD CONSTRAINT resolution_club_identity UNIQUE(club_id,resolution_id);
ALTER TABLE exit_notice ADD COLUMN writeoff_resolution_id UUID,
 ADD FOREIGN KEY(club_id,writeoff_resolution_id) REFERENCES resolution(club_id,resolution_id);
CREATE UNIQUE INDEX exit_writeoff_once ON exit_notice(club_id,writeoff_resolution_id) WHERE writeoff_resolution_id IS NOT NULL;

CREATE FUNCTION exit_writeoff_snapshot(p_club UUID,p_notice UUID) RETURNS JSONB LANGUAGE sql STABLE AS $$
 SELECT jsonb_build_object('noticeId',n.notice_id,'memberId',n.member_id,
  'amount',coalesce(sum(c.expected_amount-c.captured_amount-c.written_off_amount),0)::numeric(12,2)::text,
  'items',coalesce(jsonb_agg(jsonb_build_object('contributionId',c.contribution_id,
   'expected',c.expected_amount::text,'captured',c.captured_amount::text,
   'writtenOff',c.written_off_amount::text,
   'amount',(c.expected_amount-c.captured_amount-c.written_off_amount)::numeric(12,2)::text)
   ORDER BY c.contribution_id) FILTER(WHERE c.contribution_id IS NOT NULL),'[]'::jsonb))
 FROM exit_notice n LEFT JOIN contribution c ON c.club_id=n.club_id AND c.member_id=n.member_id
  AND c.expected_amount>c.captured_amount+c.written_off_amount
 WHERE n.club_id=p_club AND n.notice_id=p_notice AND n.status='Pending'
 GROUP BY n.notice_id,n.member_id;
$$;
CREATE FUNCTION resolution_exit_writeoff_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE snap JSONB; m meeting%ROWTYPE;
BEGIN
 IF NEW.payload ? 'exitWriteOff' THEN
  IF NEW.kind<>'General' THEN RAISE EXCEPTION 'Exit write-offs use the adopted General resolution voting rule'; END IF;
  SELECT * INTO m FROM meeting WHERE club_id=NEW.club_id AND meeting_id=NEW.meeting_id;
  IF TG_OP='INSERT' THEN
   IF m.meeting_date<>(now() AT TIME ZONE 'Africa/Johannesburg')::date THEN
    RAISE EXCEPTION 'Record a debt snapshot vote on its meeting date; past debt cannot be inferred'; END IF;
   snap:=exit_writeoff_snapshot(NEW.club_id,(NEW.payload->'exitWriteOff'->>'noticeId')::uuid);
   IF snap IS NULL OR NEW.payload->'exitWriteOff' IS DISTINCT FROM snap OR (snap->>'amount')::numeric<=0 THEN
    RAISE EXCEPTION 'Resolution must name the exact current debts of a pending exit'; END IF;
  END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER resolution_exit_writeoff_guard BEFORE INSERT ON resolution
 FOR EACH ROW EXECUTE FUNCTION resolution_exit_writeoff_guard();

CREATE TABLE contribution_writeoff (
 club_id UUID NOT NULL,contribution_id UUID NOT NULL,notice_id UUID NOT NULL,resolution_id UUID NOT NULL,
 amount NUMERIC(12,2) NOT NULL CHECK(amount>0),recorded_by UUID NOT NULL REFERENCES user_account(user_id),
 recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),PRIMARY KEY(club_id,contribution_id),
 FOREIGN KEY(club_id,contribution_id) REFERENCES contribution(club_id,contribution_id),
 FOREIGN KEY(club_id,notice_id) REFERENCES exit_notice(club_id,notice_id),
 FOREIGN KEY(club_id,resolution_id) REFERENCES resolution(club_id,resolution_id)
);
CREATE TRIGGER contribution_writeoff_immutable BEFORE UPDATE OR DELETE ON contribution_writeoff
 FOR EACH ROW EXECUTE FUNCTION completion_immutable();
CREATE FUNCTION contribution_writeoff_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE c contribution%ROWTYPE; n exit_notice%ROWTYPE; r resolution%ROWTYPE; item JSONB;
BEGIN
 SELECT * INTO c FROM contribution WHERE club_id=NEW.club_id AND contribution_id=NEW.contribution_id;
 SELECT * INTO n FROM exit_notice WHERE club_id=NEW.club_id AND notice_id=NEW.notice_id;
 SELECT * INTO r FROM resolution WHERE club_id=NEW.club_id AND resolution_id=NEW.resolution_id;
 SELECT value INTO item FROM jsonb_array_elements(r.payload->'exitWriteOff'->'items') WHERE value->>'contributionId'=NEW.contribution_id::text;
 IF c.member_id IS DISTINCT FROM n.member_id OR n.status IS DISTINCT FROM 'Pending'
  OR r.outcome IS DISTINCT FROM 'Carried' OR r.applied_at IS NULL OR r.applied_by IS DISTINCT FROM NEW.recorded_by
  OR r.payload->'exitWriteOff'->>'noticeId' IS DISTINCT FROM NEW.notice_id::text
  OR item IS NULL OR (item->>'amount')::numeric IS DISTINCT FROM NEW.amount
  OR c.expected_amount-c.captured_amount-c.written_off_amount IS DISTINCT FROM NEW.amount
 THEN RAISE EXCEPTION 'Debt write-off must match the carried resolution and exact unsettled contribution'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contribution_writeoff_guard BEFORE INSERT ON contribution_writeoff FOR EACH ROW EXECUTE FUNCTION contribution_writeoff_guard();
CREATE FUNCTION contribution_debt_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='INSERT' THEN
  IF NEW.written_off_amount<>0 THEN RAISE EXCEPTION 'New contributions cannot start written off'; END IF;
 ELSIF (OLD.written_off_amount>0 OR NEW.written_off_amount>0) AND
  (NEW.expected_amount,NEW.captured_amount,NEW.club_id,NEW.member_id,NEW.cycle_id)
  IS DISTINCT FROM (OLD.expected_amount,OLD.captured_amount,OLD.club_id,OLD.member_id,OLD.cycle_id)
 THEN RAISE EXCEPTION 'Written-off contribution financial history cannot change';
 ELSIF OLD.written_off_amount>0 AND NEW.written_off_amount IS DISTINCT FROM OLD.written_off_amount THEN RAISE EXCEPTION 'Written-off amount cannot change';
 ELSIF NEW.written_off_amount IS DISTINCT FROM OLD.written_off_amount AND NOT EXISTS(
  SELECT 1 FROM contribution_writeoff w WHERE w.club_id=NEW.club_id AND w.contribution_id=NEW.contribution_id AND w.amount=NEW.written_off_amount)
 THEN RAISE EXCEPTION 'A contribution write-off requires its resolution allocation';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER contribution_debt_guard BEFORE INSERT OR UPDATE ON contribution FOR EACH ROW EXECUTE FUNCTION contribution_debt_guard();
CREATE FUNCTION exit_writeoff_committed_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM exit_notice n JOIN member m ON m.club_id=n.club_id AND m.member_id=n.member_id
 JOIN contribution c ON c.club_id=n.club_id AND c.contribution_id=NEW.contribution_id
 WHERE n.club_id=NEW.club_id AND n.notice_id=NEW.notice_id AND n.status='Approved'
 AND n.writeoff_resolution_id=NEW.resolution_id AND m.standing='Exited' AND c.written_off_amount=NEW.amount)
 THEN RAISE EXCEPTION 'A debt write-off must commit with its approved exit'; END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER exit_writeoff_committed_guard AFTER INSERT ON contribution_writeoff
 DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION exit_writeoff_committed_guard();
