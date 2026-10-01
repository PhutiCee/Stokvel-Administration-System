"use strict";
const list = (db, memberId) =>
  db.many(
    "SELECT beneficiary_id,name,relationship,share_percent FROM beneficiary WHERE club_id=$1 AND member_id=$2 ORDER BY created_at,beneficiary_id",
    [db.clubId, memberId],
  );
async function replace(db, memberId, rows) {
  await db.query("DELETE FROM beneficiary WHERE club_id=$1 AND member_id=$2", [
    db.clubId,
    memberId,
  ]);
  for (const r of rows)
    await db.query(
      "INSERT INTO beneficiary(club_id,member_id,name,relationship,share_percent) VALUES($1,$2,$3,$4,$5)",
      [db.clubId, memberId, r.name, r.relationship, r.share],
    );
  return list(db, memberId);
}
module.exports = { list, replace };
