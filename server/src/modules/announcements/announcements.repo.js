"use strict";
const get = (db, id) =>
  db.one("SELECT * FROM announcement WHERE club_id=$1 AND announcement_id=$2", [
    db.clubId,
    id,
  ]);
const publish = (db, x) =>
  db.one(
    "INSERT INTO announcement(club_id,author_id,subject,body,corrects_id) VALUES($1,$2,$3,$4,$5) RETURNING *",
    [db.clubId, x.authorId, x.subject, x.body, x.correctsId],
  );
const list = (db, offset) =>
  db.many(
    `SELECT a.*,u.full_name AS author_name,
 (SELECT json_build_object('announcement_id',p.announcement_id,'subject',p.subject,'body',p.body,'published_at',p.published_at) FROM announcement p WHERE p.club_id=a.club_id AND p.announcement_id=a.corrects_id) AS original,
 COALESCE((SELECT json_agg(json_build_object('announcement_id',c.announcement_id,'subject',c.subject,'body',c.body,'published_at',c.published_at) ORDER BY c.published_at DESC,c.announcement_id DESC) FROM announcement c WHERE c.club_id=a.club_id AND c.corrects_id=a.announcement_id),'[]'::json) AS corrections
 FROM announcement a JOIN user_account u ON u.user_id=a.author_id WHERE a.club_id=$1 ORDER BY a.published_at DESC,a.announcement_id DESC LIMIT 21 OFFSET $2`,
    [db.clubId, offset],
  );
module.exports = { get, publish, list };
