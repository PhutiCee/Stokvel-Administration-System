"use strict";
const repo = require("./governance.repo");
const rules = require("../../rules/governance");
const constitution = require("../constitution/constitution.service");
const {
    validateNewVersion,
    AMENDABLE_FIELDS,
} = require("../../rules/versioning");
const { withClubTransaction } = require("../../db/tx");
const { todayIso, isIsoDate } = require("../../lib/dates");
const {
    BadRequest,
    NotFound,
    RuleRefusal,
    Forbidden,
} = require("../../lib/errors");
const { can } = require("../../rules/permissions");
const { removeFromQueue } = require("../queue/queue.service");
function id(value) {
    if (
        typeof value !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
            value,
        )
    )
        throw new BadRequest("Invalid record identifier.");
    return value;
}
// Audit refusals after rollback; successful events only after commit.
async function write(db, action, ctx, operation) {
    try {
        const result = await withClubTransaction(db.clubId, async (tx) => {
            await repo.lockClub(tx);
            return operation(tx);
        });
        await ctx.audit(action, "Success", {
            targetType: "governance",
            targetId: result.resolution_id || result.meeting_id,
            detail: `${ctx.actor.fullName}: ${action}`,
        });
        return result;
    } catch (err) {
        if (err.status)
            await ctx.audit(action, "Refused", {
                targetType: "governance",
                detail: err.message,
            });
        throw err;
    }
}
async function candidates(db, date = todayIso()) {
    if (!isIsoDate(date) || date > todayIso())
        throw new BadRequest("Choose a meeting date, today or earlier.");
    const c = await constitution.getVersionInForceOn(db, date);
    return { members: await repo.membersOn(db, date), constitution: c };
}
async function detail(db, meetingId) {
    id(meetingId);
    const m = await repo.getMeeting(db, meetingId);
    if (!m) throw new NotFound("Meeting not found in this club.");
    const c = (await constitution.listVersions(db)).find(
        (v) => v.constitutionId === m.constitution_id,
    );
    return {
        ...m,
        amendmentMajorityPercentage: c.amendmentMajorityPercentage,
        constitutionVersion: c.version,
        attendance: await repo.attendance(db, meetingId),
        resolutions: await repo.resolutions(db, meetingId),
    };
}
async function recordMeeting(db, input, ctx) {
    return write(db, "governance.meeting", ctx, async (tx) => {
        const data = await candidates(tx, input.date);
        const check = rules.meeting(
            input,
            data.members.map((m) => m.member_id),
            data.constitution,
            todayIso(),
        );
        return repo.insertMeeting(
            tx,
            check,
            data.constitution,
            ctx.actor.userId,
        );
    });
}
async function recordResolution(db, meetingId, input, ctx) {
    return write(db, "governance.resolution", ctx, async (tx) => {
        id(meetingId);
        const m = await repo.getMeeting(tx, meetingId);
        if (!m) throw new NotFound("Meeting not found in this club.");
        const versions = await constitution.listVersions(tx);
        const c = versions.find((v) => v.constitutionId === m.constitution_id);
        const check = rules.resolution(input, m, c.amendmentMajorityPercentage);
        let payload = {};
        if (input.kind === "Amendment") {
            if (!can(ctx.actor.role, "constitution.propose"))
                throw new Forbidden(
                    "Only the Chairperson may submit a constitutional amendment.",
                );
            if (
                !input.changes ||
                typeof input.changes !== "object" ||
                Array.isArray(input.changes) ||
                Object.keys(input.changes).some(
                    (k) => !AMENDABLE_FIELDS.includes(k),
                )
            )
                throw new BadRequest("Supply supported constitution changes.");
            // Do not merge a vote into a different or already scheduled constitution.
            if (versions.at(-1).constitutionId !== c.constitutionId)
                throw new RuleRefusal(
                    "The constitution has changed since this meeting. Record a new meeting and resolution.",
                );
            const club = await repo.lockClub(tx);
            const valid = validateNewVersion({
                existing: versions,
                clubType: club.club_type,
                changes: input.changes,
                effectiveDate: input.effectiveDate,
                amendmentNote: check.text,
                today: todayIso(),
            });
            if (!valid.valid)
                throw new BadRequest(Object.values(valid.errors).join(" "));
            payload = {
                changes: input.changes,
                effectiveDate: input.effectiveDate,
                baseConstitutionId: c.constitutionId,
            };
        }
        if (input.kind === "Expulsion") {
            const member = await repo.member(tx, id(input.memberId));
            if (!member) throw new NotFound("Member not found in this club.");
            if (["Exited", "Expelled"].includes(member.standing))
                throw new RuleRefusal("This membership has already ended.");
            payload = { memberId: input.memberId };
        }
        return repo.insertResolution(
            tx,
            meetingId,
            input,
            check,
            payload,
            ctx.actor.userId,
        );
    });
}
async function giveEffect(db, resolutionId, ctx) {
    return write(db, "governance.apply", ctx, async (tx) => {
        const row = await repo.getResolution(tx, id(resolutionId));
        if (!row) throw new NotFound("Resolution not found in this club.");
        rules.assertEffectable(row);
        let versionId = null;
        if (row.kind === "Amendment") {
            const versions = await constitution.listVersions(tx);
            if (
                versions.at(-1).constitutionId !==
                row.payload.baseConstitutionId
            )
                throw new RuleRefusal(
                    "The constitution has changed since this vote. A new resolution is required.",
                );
            const result = await constitution.createNewVersion(
                tx,
                { ...row.payload, amendmentNote: row.text },
                { actor: ctx.actor, transaction: tx, audit: async () => {} },
            );
            versionId = result.constitution.constitutionId;
        }
        if (row.kind === "Expulsion") {
            const member = await repo.member(tx, row.payload.memberId);
            if (!member || ["Exited", "Expelled"].includes(member.standing))
                throw new RuleRefusal("This membership has already ended.");
            if (
                ["Chairperson", "Treasurer"].includes(member.role) &&
                (await repo.activeRoleCount(tx, member.role)) <= 1
            )
                throw new RuleRefusal(
                    `Appoint a replacement ${member.role} before applying this expulsion (REQ-49).`,
                );
            await removeFromQueue(tx, member.member_id);
            await repo.expel(tx, member.member_id, todayIso());
        }
        return repo.markApplied(
            tx,
            row.resolution_id,
            ctx.actor.userId,
            versionId,
        );
    });
}
module.exports = {
    list: repo.listMeetings,
    candidates,
    detail,
    recordMeeting,
    recordResolution,
    giveEffect,
};
