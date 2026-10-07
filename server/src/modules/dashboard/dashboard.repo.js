"use strict";
exports.book = (db) =>
  db.many(
    `SELECT e.entry_id,e.member_id,e.posted_at,e.description,e.cash_amount::text AS amount,e.amount::text AS assessed_amount,
 to_char(e.posted_at AT TIME ZONE 'Africa/Johannesburg','YYYY-MM') AS month,
 coalesce(o.entry_type,e.entry_type)::text AS category
 FROM cash_ledger_entry e LEFT JOIN ledger_entry o ON o.club_id=e.club_id AND o.entry_id=e.reverses_id
 WHERE e.club_id=$1 ORDER BY e.posted_at DESC,e.entry_id DESC`,
    [db.clubId],
  );
exports.contributions = (db, own) =>
  db.many(
    `SELECT c.contribution_id,u.full_name,c.expected_amount::text,c.captured_amount::text,c.written_off_amount::text,
 greatest(c.expected_amount - c.captured_amount - c.written_off_amount,0)::text AS outstanding,y.due_date::text
 FROM contribution c JOIN member m ON m.club_id=c.club_id AND m.member_id=c.member_id
 JOIN user_account u ON u.user_id=m.user_id JOIN cycle y ON y.club_id=c.club_id AND y.cycle_id=c.cycle_id
 WHERE c.club_id=$1 AND ($2::uuid IS NULL OR c.member_id=$2) ORDER BY y.due_date,c.contribution_id`,
    [db.clubId, own],
  );
exports.penalties = (db, own) =>
  db.many(
    `SELECT penalty_id,reason,amount::text,settled_amount::text,(amount-settled_amount)::text AS outstanding
 FROM penalty WHERE club_id=$1 AND member_id=$2 AND waived_at IS NULL AND amount>settled_amount ORDER BY penalty_id`,
    [db.clubId, own],
  );
exports.reconciliation = (db) =>
  db.many(
    `SELECT reconciliation_id,as_at_date::text,bank_balance::text,ledger_balance::text,difference::text,note FROM reconciliation WHERE club_id=$1 ORDER BY as_at_date DESC,recorded_at DESC,reconciliation_id DESC LIMIT 1`,
    [db.clubId],
  );
exports.approvals = (db) =>
  db.many(
    `SELECT payout_id,payout_type,amount::text,initiated_at FROM payout WHERE club_id=$1 AND status='Initiated' ORDER BY initiated_at`,
    [db.clubId],
  );
exports.exits = (db) =>
  db.many(
    `SELECT n.notice_id,u.full_name,n.notice_date::text,n.earliest_exit::text FROM exit_notice n JOIN member m ON m.club_id=n.club_id AND m.member_id=n.member_id JOIN user_account u ON u.user_id=m.user_id WHERE n.club_id=$1 AND n.status='Pending' ORDER BY n.created_at`,
    [db.clubId],
  );
exports.overdue = (db, today) =>
  db.many(
    `SELECT c.cycle_id,c.sequence_number,c.due_date::text FROM cycle c JOIN club b ON b.club_id=c.club_id WHERE c.club_id=$1 AND b.club_type='Rotating' AND c.due_date<$2::date-7 AND NOT EXISTS(SELECT 1 FROM payout p WHERE p.club_id=c.club_id AND p.cycle_id=c.cycle_id AND p.payout_type='Rotation' AND p.status='Approved' AND p.reversed_entry_id IS NULL) ORDER BY c.due_date`,
    [db.clubId, today],
  );
