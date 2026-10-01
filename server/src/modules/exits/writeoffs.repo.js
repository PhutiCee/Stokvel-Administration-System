"use strict";
exports.snapshot = (db, id) =>
  db
    .one(
      "SELECT exit_writeoff_snapshot($1,$2) AS snapshot /* club_id scoped arguments */",
      [db.clubId, id],
    )
    .then((r) => r.snapshot);
exports.candidates = (db) =>
  db.many(
    `SELECT n.notice_id,u.full_name,exit_writeoff_snapshot(n.club_id,n.notice_id) AS snapshot
 FROM exit_notice n JOIN member m ON m.club_id=n.club_id AND m.member_id=n.member_id JOIN user_account u ON u.user_id=m.user_id
 WHERE n.club_id=$1 AND n.status='Pending' AND EXISTS(SELECT 1 FROM contribution c WHERE c.club_id=n.club_id AND c.member_id=n.member_id AND c.expected_amount>c.captured_amount+c.written_off_amount)
 ORDER BY n.created_at`,
    [db.clubId],
  );
exports.apply = async (db, notice, resolution, actor) => {
  for (const item of resolution.payload.exitWriteOff.items) {
    await db.query(
      "INSERT INTO contribution_writeoff(club_id,contribution_id,notice_id,resolution_id,amount,recorded_by) VALUES($1,$2,$3,$4,$5,$6)",
      [
        db.clubId,
        item.contributionId,
        notice.notice_id,
        resolution.resolution_id,
        item.amount,
        actor,
      ],
    );
    await db.query(
      "UPDATE contribution SET written_off_amount=$3,updated_at=now() WHERE club_id=$1 AND contribution_id=$2",
      [db.clubId, item.contributionId, item.amount],
    );
  }
};
