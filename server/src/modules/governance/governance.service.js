"use strict";
const repo = require("./governance.repo");
const rules = require("../../rules/governance");
const policyRules = require("../../rules/governance-policy");
const constitution = require("../constitution/constitution.service");
const { validateNewVersion } = require("../../rules/versioning");
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
const { assessRoleCapacity } = require("../../rules/officers");
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
function requireAction(ctx, action) {
    if (!can(ctx.actor.role, action))
        throw new Forbidden("Your role cannot perform this governance action.");
}
async function write(db, action, ctx, operation) {
    let result;
    try {
        result = await withClubTransaction(db.clubId, async (tx) => {
            await repo.lockClub(tx);
            return operation(tx);
        });
    } catch (err) {
        if (err.status)
            await ctx.audit(action, "Refused", {
                targetType: "governance",
                detail: err.message,
            });
        throw err;
    }
    await ctx.audit(action, "Success", {
        targetType: "governance",
        targetId:
            result.resolution_id ||
            result.meeting_id ||
            result.proposal_id ||
            null,
        detail: `${ctx.actor.fullName}: ${action}`,
    });
    return result;
}
async function policyFor(db, c, date) {
    if (c.governancePolicy)
        return policyRules.validatePolicy(
            c.governancePolicy,
            await repo.clubType(db),
        );
    const initial = await repo.initialPolicy(db);
    return initial && initial.effective_date <= date
        ? policyRules.validatePolicy(initial.policy, await repo.clubType(db))
        : null;
}
async function settings(db) {
    const c = await constitution.getVersionInForceOn(db);
    return {
        policy: await policyFor(db, c, todayIso()),
        canInitialise: !(await repo.initialPolicy(db)) && !c.governancePolicy,
        constitution: c,
        fields: policyRules.fieldsFor(await repo.clubType(db)),
    };
}
async function recordPolicy(db, input, ctx) {
    return write(db, "governance.recordVotingRules", ctx, async (tx) => {
        requireAction(ctx, "constitution.propose");
        const c = await constitution.getVersionInForceOn(tx);
        if ((await repo.initialPolicy(tx)) || c.governancePolicy)
            throw new RuleRefusal(
                "Voting rules are already recorded. Changes require an amendment proposal and member resolution.",
            );
        const policy = policyRules.validatePolicy(
            input.policy,
            await repo.clubType(tx),
        );
        if (
            !isIsoDate(input.effectiveDate) ||
            input.effectiveDate > todayIso() ||
            input.effectiveDate < c.effectiveDate
        )
            throw new BadRequest(
                "Enter when these adopted voting rules took effect, within the current constitution and no later than today.",
            );
        if (input.confirmAdopted !== true)
            throw new BadRequest(
                "Confirm that these are existing adopted rules, not a unilateral rule change.",
            );
        return repo.insertInitialPolicy(
            tx,
            policy,
            input.effectiveDate,
            ctx.actor.userId,
        );
    });
}
async function candidates(db, date = todayIso()) {
    if (!isIsoDate(date) || date > todayIso())
        throw new BadRequest("Choose a meeting date, today or earlier.");
    const first = await repo.historyStart(db);
    if (first?.date && date < first.date)
        throw new RuleRefusal(
            `Verified membership history starts on ${first.date}. Earlier attendance cannot be inferred safely.`,
        );
    const c = await constitution.getVersionInForceOn(db, date),
        policy = await policyFor(db, c, date);
    const members = await repo.historicalMembers(db, date);
    return {
        members: members.map((m) => ({
            ...m,
            canVote: policy ? policyRules.mayVote(m, policy) : false,
        })),
        constitution: c,
        policy,
    };
}
async function detail(db, meetingId) {
    const m = await repo.getMeeting(db, id(meetingId));
    if (!m) throw new NotFound("Meeting not found in this club.");
    const c = (await constitution.listVersions(db)).find(
        (v) => v.constitutionId === m.constitution_id,
    );
    return {
        ...m,
        constitutionVersion: c.version,
        attendance: await repo.attendance(db, meetingId),
        resolutions: await repo.resolutions(db, meetingId),
    };
}
async function recordMeeting(db, input, ctx) {
    return write(db, "governance.meeting", ctx, async (tx) => {
        requireAction(ctx, "governance.record");
        const data = await candidates(tx, input.date);
        if (!data.policy)
            throw new RuleRefusal(
                "Record the adopted constitutional voting rules before recording a new meeting.",
            );
        const check = rules.meeting(
            input,
            data.members.map((m) => m.member_id),
            data.constitution,
            todayIso(),
        );
        Object.assign(check, {
            policy: data.policy,
            voterCount: data.members.filter(
                (m) => m.canVote && check.attendance.includes(m.member_id),
            ).length,
            eligibleVoters: data.members.filter((m) => m.canVote).length,
            electorate: data.members,
        });
        return repo.insertMeeting(
            tx,
            check,
            data.constitution,
            ctx.actor.userId,
        );
    });
}
async function proposeAmendment(db, input, ctx) {
    return write(db, "governance.proposeAmendment", ctx, async (tx) => {
        requireAction(ctx, "constitution.propose");
        const versions = await constitution.listVersions(tx),
            current = await constitution.getVersionInForceOn(tx),
            club = await repo.lockClub(tx);
        if (versions.at(-1).constitutionId !== current.constitutionId)
            throw new RuleRefusal(
                "A constitution version is already scheduled. Wait until it takes effect before proposing another amendment.",
            );
        const policy = await policyFor(tx, current, todayIso());
        if (!policy)
            throw new RuleRefusal("Record adopted voting rules first.");
        if (
            !input.changes ||
            typeof input.changes !== "object" ||
            Array.isArray(input.changes)
        )
            throw new BadRequest("Supply the proposed changes.");
        policyRules.applicableRules(policy, "Amendment", input.changes);
        const changes = { ...input.changes };
        if (changes.governancePolicy !== undefined)
            changes.governancePolicy = policyRules.validatePolicy(
                changes.governancePolicy,
                club.club_type,
            );
        const text = rules.text(input.text, "Amendment text and reason");
        const check = validateNewVersion({
            existing: versions,
            clubType: club.club_type,
            changes,
            effectiveDate: input.effectiveDate,
            amendmentNote: text,
            today: todayIso(),
        });
        if (!check.valid)
            throw new BadRequest(Object.values(check.errors).join(" "));
        return repo.insertProposal(
            tx,
            { text, changes, effectiveDate: input.effectiveDate },
            current.constitutionId,
            ctx.actor.userId,
        );
    });
}
async function checkSuccession(tx, subject, successorId) {
    const people = await repo.membersOn(tx, todayIso());
    const holders = people.filter((m) => m.role === subject.role).length;
    if (successorId) {
        const successor = await repo.member(tx, id(successorId));
        if (!successor)
            throw new NotFound("Replacement member not found in this club.");
        if (
            !people.some((m) => m.member_id === successor.member_id) ||
            !["Chairperson", "Treasurer", "Secretary"].includes(subject.role) ||
            successor.member_id === subject.member_id ||
            successor.standing !== "Good standing" ||
            successor.role !== "Member"
        )
            throw new RuleRefusal(
                "An officer replacement must be a different ordinary member in good standing.",
            );
        const check = assessRoleCapacity({
            role: subject.role,
            currentHolders: holders - 1,
            activeMemberCount: people.length - 1,
        });
        if (!check.eligible)
            throw new RuleRefusal(
                check.refusals.map((r) => r.message).join(" "),
            );
        return successor;
    }
    if (["Chairperson", "Treasurer"].includes(subject.role) && holders <= 1)
        throw new RuleRefusal(
            `Name a replacement ${subject.role} in the resolution to preserve REQ-49.`,
        );
    return null;
}
async function recordResolution(db, meetingId, input, ctx) {
    return write(db, "governance.resolution", ctx, async (tx) => {
        requireAction(ctx, "governance.record");
        const m = await repo.getMeeting(tx, id(meetingId));
        if (!m) throw new NotFound("Meeting not found in this club.");
        if (!m.voting_policy)
            throw new RuleRefusal(
                "This legacy meeting predates confirmed voting rules. Record a new meeting.",
            );
        if (!["General", "Amendment", "Expulsion"].includes(input.kind))
            throw new BadRequest("Choose a resolution type.");
        let payload = {},
            text = input.text,
            proposalId = null;
        if (input.kind === "Amendment") {
            const p = await repo.getProposal(tx, id(input.proposalId));
            if (!p) throw new NotFound("Proposal not found in this club.");
            if (await repo.proposalOutcome(tx, p.proposal_id))
                throw new RuleRefusal(
                    "This proposal already has a binding decision. Submit a new proposal if changes are needed.",
                );
            const versions = await constitution.listVersions(tx);
            if (
                p.base_constitution_id !== m.constitution_id ||
                versions.at(-1).constitutionId !== p.base_constitution_id
            )
                throw new RuleRefusal(
                    "This proposal and meeting must use the latest constitution. Submit a fresh proposal after a rule change.",
                );
            if (m.meeting_date < p.proposed_date)
                throw new RuleRefusal(
                    "The meeting cannot predate the proposal.",
                );
            if (p.effective_date < todayIso())
                throw new RuleRefusal(
                    "The proposal effective date has passed. Submit a new proposal with a prospective date.",
                );
            text = p.text;
            proposalId = p.proposal_id;
            payload = {
                changes: p.changes,
                effectiveDate: p.effective_date,
                baseConstitutionId: p.base_constitution_id,
            };
        } else if (input.kind === "Expulsion") {
            const member = await repo.member(tx, id(input.memberId));
            if (!member) throw new NotFound("Member not found in this club.");
            if (["Exited", "Expelled"].includes(member.standing))
                throw new RuleRefusal("This membership has already ended.");
            const successor = await checkSuccession(
                tx,
                member,
                input.successorMemberId,
            );
            payload = {
                memberId: member.member_id,
                roleAtVote: member.role,
                successorMemberId: successor?.member_id || null,
            };
        }
        const check = policyRules.assessVote(
            input,
            m,
            policyRules.applicableRules(
                m.voting_policy,
                input.kind,
                payload.changes,
            ),
        );
        check.text = rules.text(text, "Resolution text");
        return repo.insertResolution(
            tx,
            meetingId,
            { ...input, proposalId },
            check,
            payload,
            ctx.actor.userId,
        );
    });
}
async function giveEffect(db, resolutionId, ctx) {
    return write(db, "governance.apply", ctx, async (tx) => {
        requireAction(ctx, "governance.apply");
        const row = await repo.getResolution(tx, id(resolutionId));
        if (!row) throw new NotFound("Resolution not found in this club.");
        rules.assertEffectable(row);
        const m = await repo.getMeeting(tx, row.meeting_id);
        if (!m.voting_policy)
            throw new RuleRefusal(
                "Legacy resolutions based on assumed voting rules cannot be applied. Record a new resolution under confirmed rules.",
            );
        let versionId = null;
        if (row.kind === "Amendment") {
            const versions = await constitution.listVersions(tx);
            if (
                versions.at(-1).constitutionId !==
                row.payload.baseConstitutionId
            )
                throw new RuleRefusal(
                    "The constitution has changed since this vote. A new proposal and resolution are required.",
                );
            const result = await constitution.createNewVersion(
                tx,
                {
                    ...row.payload,
                    amendmentNote: row.text,
                    inheritedGovernancePolicy: m.voting_policy,
                },
                { actor: ctx.actor, transaction: tx, audit: async () => {} },
            );
            versionId = result.constitution.constitutionId;
        }
        if (row.kind === "Expulsion") {
            const member = await repo.member(tx, row.payload.memberId);
            if (!member || ["Exited", "Expelled"].includes(member.standing))
                throw new RuleRefusal("This membership has already ended.");
            if (member.role !== row.payload.roleAtVote)
                throw new RuleRefusal(
                    "The officer role changed after the vote. A new resolution is required.",
                );
            const successor = await checkSuccession(
                tx,
                member,
                row.payload.successorMemberId,
            );
            await removeFromQueue(tx, member.member_id);
            await repo.expel(tx, member.member_id, todayIso());
            if (successor) {
                await repo.appoint(tx, member.member_id, "Member");
                await repo.appoint(tx, successor.member_id, member.role);
            }
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
    settings,
    recordPolicy,
    proposals: repo.proposals,
    proposeAmendment,
    recordMeeting,
    recordResolution,
    giveEffect,
};

// REQ-110: calendar year report, with a clearly labelled current-year cut-off.
module.exports.annualReport = async (db, yearValue) => {
    const { addDays } = require("../../lib/dates");
    const today = todayIso(),
        year = String(yearValue ?? today.slice(0, 4));
    if (
        !/^\d{4}$/.test(year) ||
        Number(year) < 1900 ||
        Number(year) > Number(today.slice(0, 4))
    )
        throw new BadRequest(
            "Choose a valid reporting year, no later than the current year.",
        );
    const start = year + "-01-01",
        last = year + "-12-31",
        asAt = last < today ? last : today;
    return {
        year: Number(year),
        start,
        asAt,
        completeYear: asAt === last,
        ...(await repo.annualReport(db, start, addDays(asAt, 1))),
    };
};
