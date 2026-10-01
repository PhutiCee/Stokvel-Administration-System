"use strict";

/**
 * Club notifications service.
 *
 *     sendNotification()   the Secretary broadcasts a message to the club
 *     listNotifications()  every member reads what was sent, newest first
 *
 * No transaction and no rules engine: this is an announcement, not a
 * financial operation, and it carries no waterfall or eligibility logic.
 *
 * No Express in this file.
 */

const repo = require("./notifications.repo");
const { BadRequest } = require("../../lib/errors");

async function sendNotification(db, { title, message }, { actor, audit }) {
    if (!title || !String(title).trim()) throw new BadRequest("Give the notification a title.");
    if (!message || !String(message).trim()) throw new BadRequest("Write the message to send.");

    if(typeof title!=='string' || title.trim().length>120 || typeof message!=='string' || message.trim().length>10000)throw new BadRequest('Use a title of at most 120 characters and a message of at most 10000 characters.');
    const created = await repo.insertNotification(db, {
        title: String(title).trim(),
        message: String(message).trim(),
        sentBy: actor.userId
    });

    await audit("notification.send", "Success", {
        detail: `${actor.fullName} sent a notification to the club: "${created.title}"`,
        targetType: "notification",
        targetId: created.notification_id
    });

    return {
        notificationId: created.notification_id,
        title: created.title,
        message: created.message,
        sentBy: actor.fullName,
        createdAt: created.created_at
    };
}

async function listNotifications(db) {
    return repo.listForClub(db);
}

module.exports = { sendNotification, listNotifications };
