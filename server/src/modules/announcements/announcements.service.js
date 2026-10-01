"use strict";
const repo = require("./announcements.repo");
const { BadRequest, NotFound } = require("../../lib/errors");
async function list(db, offset = 0) {
  offset = Number(offset);
  if (!Number.isSafeInteger(offset) || offset < 0)
    throw new BadRequest("Invalid page.");
  const rows = await repo.list(db, offset);
  return { announcements: rows.slice(0, 20), hasMore: rows.length > 20 };
}
async function publish(db, input, { actor, audit }) {
  try {
    if (
      typeof input.subject !== "string" ||
      !input.subject.trim() ||
      input.subject.trim().length > 160 ||
      typeof input.body !== "string" ||
      !input.body.trim() ||
      input.body.trim().length > 10000
    )
      throw new BadRequest(
        "Enter a subject (1–160 characters) and body (1–10000 characters).",
      );
    if (input.correctsId) {
      if (
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(input.correctsId)
      )
        throw new BadRequest("Invalid original announcement.");
      if (!(await repo.get(db, input.correctsId)))
        throw new NotFound("Original announcement not found in this club.");
    }
    const row = await repo.publish(db, {
      authorId: actor.userId,
      subject: input.subject.trim(),
      body: input.body.trim(),
      correctsId: input.correctsId || null,
    });
    await audit("announcement.publish", "Success", {
      targetType: "announcement",
      targetId: row.announcement_id,
      detail: row.subject,
    });
    return row;
  } catch (e) {
    if (e.status)
      await audit("announcement.publish", "Refused", { detail: e.message });
    throw e;
  }
}
module.exports = { list, publish };
