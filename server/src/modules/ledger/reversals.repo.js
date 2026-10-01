"use strict";
const lockClub = (db) =>
  db.one("SELECT club_id FROM club WHERE club_id=$1 FOR UPDATE", [db.clubId]);
const getEntry = (db, id) =>
  db.one(
    `SELECT e.*,r.entry_id AS reversed_by FROM ledger_entry e
 LEFT JOIN ledger_entry r ON r.club_id=e.club_id AND r.reverses_id=e.entry_id
 WHERE e.club_id=$1 AND e.entry_id=$2`,
    [db.clubId, id],
  );
const getRequest = (db, id) =>
  db.one(
    "SELECT * FROM ledger_reversal_request WHERE club_id=$1 AND request_id=$2",
    [db.clubId, id],
  );
const liveRequest = (db, id) =>
  db.one(
    "SELECT * FROM ledger_reversal_request WHERE club_id=$1 AND entry_id=$2 AND status<>'Rejected'",
    [db.clubId, id],
  );
const create = (db, id, reason, userId) =>
  db.one(
    `INSERT INTO ledger_reversal_request(club_id,entry_id,reason,requested_by,status)
 VALUES($1,$2,$3,$4,'Pending') RETURNING *`,
    [db.clubId, id, reason, userId],
  );
const decide = (db, id, userId, status, reason) =>
  db.one(
    `UPDATE ledger_reversal_request SET status=$3,decided_by=$4,decided_at=now(),decision_reason=$5
 WHERE club_id=$1 AND request_id=$2 RETURNING *`,
    [db.clubId, id, status, userId, reason],
  );
const posted = (db, id, entryId, userId) =>
  db.one(
    `UPDATE ledger_reversal_request SET status='Posted',posted_entry_id=$3,posted_by=$4,posted_at=now()
 WHERE club_id=$1 AND request_id=$2 RETURNING *`,
    [db.clubId, id, entryId, userId],
  );
const list = (db) =>
  db.many(
    `SELECT r.*,e.entry_type,e.amount,e.description,u.full_name AS requested_by_name,
 d.full_name AS decided_by_name FROM ledger_reversal_request r
 JOIN ledger_entry e ON e.club_id=r.club_id AND e.entry_id=r.entry_id
 JOIN user_account u ON u.user_id=r.requested_by LEFT JOIN user_account d ON d.user_id=r.decided_by
 WHERE r.club_id=$1 ORDER BY CASE WHEN r.status IN ('Pending','Approved') THEN 0 ELSE 1 END,r.requested_at DESC,r.request_id DESC`,
    [db.clubId],
  );
module.exports = {
  lockClub,
  getEntry,
  getRequest,
  liveRequest,
  create,
  decide,
  posted,
  list,
};
