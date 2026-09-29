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

async function listForClub(db, { limit = 100 } = {}) {
    const rows = await db.many(
        `SELECT n.notification_id, n.title, n.message, n.created_at::text AS created_at,
                u.full_name AS sent_by_name
           FROM notification n
           JOIN user_account u ON u.user_id = n.sent_by
          WHERE n.club_id = $1
          ORDER BY n.created_at DESC
          LIMIT $2`,
        [db.clubId, limit]
    );
    return rows.map(presentNotification);
}

module.exports = { insertNotification, listForClub };
