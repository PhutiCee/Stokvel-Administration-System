"use strict";

/**
 * Club notifications repo. SQL only, no rules.
 */

function presentNotification(r) {
    return {
        notificationId: r.notification_id,
        title: r.title,
        message: r.message,
        sentBy: r.sent_by_name,
        createdAt: r.created_at
    };
}

async function insertNotification(db, { title, message, sentBy }) {
    const r = await db.one(
        `INSERT INTO notification (club_id, sent_by, title, message)
         VALUES ($1, $2, $3, $4)
         RETURNING notification_id, title, message, created_at::text AS created_at`,
        [db.clubId, sentBy, title, message]
    );
    return r;
}

async function listForClub(db, { memberId, limit = 100 } = {}) {
    const rows = await db.many(
        `SELECT n.notification_id, n.title, n.message, n.created_at::text AS created_at,
                u.full_name AS sent_by_name
           FROM notification n
           JOIN user_account u ON u.user_id = n.sent_by
          WHERE n.club_id = $1 AND (n.member_id IS NULL OR n.member_id=$3)
          ORDER BY n.created_at DESC
          LIMIT $2`,
        [db.clubId, limit, memberId]
    );
    return rows.map(presentNotification);
}

module.exports = { insertNotification, listForClub };

module.exports.notifyMemberAndOfficers = async (db,{memberId,sentBy,key,title,message}) => {
  const members = await db.many("SELECT member_id FROM member WHERE club_id=$1 AND standing NOT IN ('Exited','Expelled') AND (member_id=$2 OR role IN ('Chairperson','Treasurer','Secretary'))",[db.clubId,memberId]);
  for (const recipient of members) await db.query(`INSERT INTO notification(club_id,sent_by,member_id,event_key,title,message)
    VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(club_id,event_key) WHERE event_key IS NOT NULL DO NOTHING`,
    [db.clubId,sentBy,recipient.member_id,`${key}:${recipient.member_id}`,title,recipient.member_id===memberId?message:'A member account requires attention. Review the contribution register and standing history.']);
};
