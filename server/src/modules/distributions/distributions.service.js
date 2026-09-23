"use strict";

/**
 * Distribution service. Use Case 3, accumulating clubs. REQ-79 to REQ-82.
 * SDD: computeDistributionShare().
 *
 *     recordInterest(), recordExpense()   the inputs REQ-80 needs, as they occur
 *     previewNextDistribution()           what initiating now would compute
 *     initiateDistribution()              the Treasurer proposes it            REQ-79, REQ-82
 *     approveDistribution()               a different officer posts it         REQ-64, REQ-81
 *     cancelDistribution()                the Treasurer withdraws it           REQ-70
 *
 * A distribution is one computation covering every current member, itemised
 * (REQ-82) and frozen at initiation the same way a rotation payout's amount is
 * frozen (decisions.md, decision 22): the Chairperson approves the SPECIFIC
 * computation shown, not a figure recomputed at the moment they click approve.
 * What IS re-checked at approval is whether that computation still holds
 * against the world as it now stands — REQ-81's reconciliation, and REQ-67's
 * standing rule — the same split rotation payouts already use for REQ-66 and
 * REQ-67.
 *
 * No Express in this file.
 */

const repo = require("./distributions.repo");
const constitutionService = require("../constitution/constitution.service");
const ledgerService = require("../ledger/ledger.service");
const { assessDistribution, describeDistributionRule } = require("../../rules/distributions");
const { withClubTransaction } = require("../../db/tx");
const { toCents, toNumeric } = require("../../lib/money");
const { todayIso, nextYearEndAfter, compareIso } = require("../../lib/dates");
const { BadRequest, NotFound, RuleRefusal } = require("../../lib/errors");

async function refuse(audit, action, message, detail, target = {}) {
    await audit(action, "Refused", {
        detail: `Refused: ${message}`,
        targetType: target.type || "distribution",
        targetId: target.id || null
    });
    throw new RuleRefusal(message, detail);
}

function requireAccumulatingForNow(clubType) {
    if (clubType === "Accumulating") return null;
    if (clubType === "Rotating") {
        return "A rotating club pays the pool to one member each cycle, not as a year-end distribution (REQ-71 to REQ-78).";
    }
    return "A burial society pays out on an assessed claim, not as a year-end distribution (REQ-83 to REQ-88).";
}

// ---------------------------------------------------------------------------
// Building the facts and calling the rule
// ---------------------------------------------------------------------------

/**
 * REQ-79. The window a distribution covers: from the end of the last one (or
 * the club's registration date, for the first) to the next year-end date named
 * in the constitution, and whether that date has arrived yet.
 */
async function resolvePeriod(db, club, constitution) {
    if (!constitution.yearEndMonth || !constitution.yearEndDay) {
        return { yearEndDate: null, periodStart: null, isDue: false };
    }
    const last = await repo.lastApprovedDistribution(db);
    const periodStart = last ? last.period_end : club.registration_date;
    const yearEndDate = nextYearEndAfter(periodStart, constitution.yearEndMonth, constitution.yearEndDay);
    const isDue = compareIso(yearEndDate, todayIso()) <= 0;
    return { yearEndDate, periodStart, isDue };
}

/** Fresh figures from the database, for a preview or a new initiation. */
async function computeFreshAssessment(db) {
    const club = await db.one(`SELECT club_id, club_type, registration_date::text AS registration_date FROM club WHERE club_id = $1`, [db.clubId]);
    const constitution = await constitutionService.getVersionInForceOn(db);
    const { yearEndDate, periodStart, isDue } = await resolvePeriod(db, club, constitution);

    let alreadyDistributed = false;
    let members = [];
    let interestCents = 0, expenseCents = 0, financials = null;
    if (yearEndDate) {
        alreadyDistributed = !!(await repo.existingForYearEnd(db, yearEndDate));
        const rows = await repo.periodMemberTotals(db, { periodStart, periodEnd: yearEndDate });
        members = rows.map((r) => ({
            memberId: r.member_id, fullName: r.full_name, standing: r.standing,
            capturedCents: toCents(r.captured), penaltyCents: toCents(r.penalties)
        }));
        financials = await repo.periodFinancialTotals(db, { periodStart, periodEnd: yearEndDate });
        interestCents = toCents(financials.interest);
        expenseCents = toCents(financials.expenses);
    }

    const poolCents = toCents((await ledgerService.getPoolBalance(db)).balance);
    const suspended = members.filter((m) => ["Suspended", "Expelled"].includes(m.standing));

    const result = assessDistribution({
        clubType: club.club_type, yearEndDate, isDue, alreadyDistributed,
        members, interestCents, expenseCents, poolCents
    });
    // REQ-67, BR-5, folded in here because it is a fact about THESE members,
    // not about the arithmetic rules/distributions.js checks.
    if (suspended.length > 0) {
        result.eligible = false;
        result.refusals.push({
            requirement: "REQ-67",
            code: "MEMBER_NOT_ELIGIBLE",
            message:
                `${suspended.map((m) => m.fullName).join(", ")} ${suspended.length === 1 ? "is" : "are"} ` +
                `${suspended.map((m) => m.standing.toLowerCase()).join("/")} and may not receive money from the ` +
                "pool (BR-5). Resolve their standing before this distribution can proceed."
        });
    }

    return { club, constitution, yearEndDate, periodStart, isDue, alreadyDistributed, members, interestCents, expenseCents, poolCents, result };
}

/**
 * The frozen computation from an existing distribution, re-checked against the
 * world as it stands now: the pool (REQ-81) and every recipient's current
 * standing (REQ-67). The shares themselves are not recomputed.
 */
async function verifyFrozenAssessment(db, distribution) {
    const club = await db.one(`SELECT club_type FROM club WHERE club_id = $1`, [db.clubId]);
    const frozen = distribution.assessment_at_initiation;
    const poolCents = toCents((await ledgerService.getPoolBalance(db)).balance);

    const memberIds = frozen.shares.perMember.map((m) => m.memberId);
    const current = await db.many(
        `SELECT m.member_id, m.standing FROM member m WHERE m.club_id = $1 AND m.member_id = ANY($2::uuid[])`,
        [db.clubId, memberIds]
    );
    const standingNow = new Map(current.map((r) => [r.member_id, r.standing]));

    const refusals = [];
    if (distribution.status !== "Initiated") {
        refusals.push({ requirement: "REQ-64", code: "NOT_INITIATED", message: `This distribution is ${distribution.status.toLowerCase()}.` });
    }
    if (toCents(frozen.totals.totalDistributed) !== poolCents) {
        refusals.push({
            requirement: "REQ-81", code: "POOL_MISMATCH",
            message:
                `This computation distributes ${toNumeric(toCents(frozen.totals.totalDistributed))}, but the pool ` +
                `now stands at ${toNumeric(poolCents)}. Activity since this distribution was initiated means it no ` +
                "longer reconciles exactly and cannot be posted as computed."
        });
    }
    const notEligible = frozen.shares.perMember.filter((m) => ["Suspended", "Expelled"].includes(standingNow.get(m.memberId)));
    if (notEligible.length > 0) {
        refusals.push({
            requirement: "REQ-67", code: "MEMBER_NOT_ELIGIBLE",
            message: `${notEligible.map((m) => m.fullName).join(", ")} ${notEligible.length === 1 ? "is" : "are"} now suspended or expelled and may not receive money from the pool (BR-5).`
        });
    }

    return { eligible: refusals.length === 0, refusals, poolCents, frozen };
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function publicPreview({ yearEndDate, periodStart, isDue, alreadyDistributed, interestCents, expenseCents, poolCents, result }) {
    return {
        yearEndDate, periodStart, isDue, alreadyDistributed,
        eligible: result.eligible,
        refusals: result.refusals,
        interest: toNumeric(interestCents),
        expenses: toNumeric(expenseCents),
        poolBalance: toNumeric(poolCents),
        shares: result.shares
            ? {
                totalDistributed: toNumeric(result.shares.totalFinalCents),
                perMember: result.shares.perMember.map((m) => ({
                    memberId: m.memberId, fullName: m.fullName,
                    captured: toNumeric(m.capturedCents), penalties: toNumeric(m.penaltyCents),
                    interestShare: toNumeric(m.interestShareCents), expenseShare: toNumeric(m.expenseShareCents),
                    finalAmount: toNumeric(m.finalCents)
                }))
            }
            : null
    };
}

async function previewNextDistribution(db) {
    const a = await computeFreshAssessment(db);
    const notYet = requireAccumulatingForNow(a.club.club_type);
    if (notYet) return { applicable: false, message: notYet };
    return { applicable: true, ...publicPreview(a) };
}

function presentDistribution(d) {
    return {
        distributionId: d.distribution_id,
        status: d.status,
        yearEndDate: d.year_end_date,
        period: { start: d.period_start, end: d.period_end },
        constitutionVersion: d.constitution_version,
        totals: {
            contributions: d.total_contributions, penalties: d.total_penalties,
            interest: d.total_interest, expenses: d.total_expenses,
            distributed: d.total_distributed, poolAtComputation: d.pool_at_computation
        },
        initiated: { by: d.initiated_by_name, userId: d.initiated_by, at: d.initiated_at },
        approved: d.approved_by ? { by: d.approved_by_name, userId: d.approved_by, at: d.approved_at } : null,
        cancelled: d.cancelled_by ? { by: d.cancelled_by_name, userId: d.cancelled_by, at: d.cancelled_at, reason: d.cancel_reason } : null,
        perMember: d.assessment_at_initiation?.shares?.perMember?.map((m) => ({
            memberId: m.memberId, fullName: m.fullName,
            captured: toNumeric(m.capturedCents), penalties: toNumeric(m.penaltyCents),
            interestShare: toNumeric(m.interestShareCents), expenseShare: toNumeric(m.expenseShareCents),
            finalAmount: toNumeric(m.finalCents)
        })) || []
    };
}

async function listDistributions(db) {
    return (await repo.listDistributions(db)).map(presentDistribution);
}

async function getDistribution(db, distributionId) {
    const d = await repo.getDistribution(db, distributionId);
    if (!d) throw new NotFound("That distribution was not found in this club.");
    const out = presentDistribution(d);
    if (d.status === "Initiated") {
        const v = await verifyFrozenAssessment(db, d);
        out.assessmentNow = { eligible: v.eligible, refusals: v.refusals, currentPoolBalance: toNumeric(v.poolCents) };
    }
    return out;
}

// ---------------------------------------------------------------------------
// REQ-80: recording the inputs the formula needs, as they occur
// ---------------------------------------------------------------------------

async function recordFinancialEntry(db, entryType, { amount, description }, { actor, audit }) {
    let cents;
    try {
        cents = toCents(amount);
    } catch {
        cents = 0;
    }
    if (!Number.isInteger(cents) || cents <= 0) {
        throw new BadRequest("Give an amount greater than zero.");
    }
    if (!description || !String(description).trim()) {
        throw new BadRequest("Record what this entry is for.");
    }

    const entry = await withClubTransaction(db.clubId, (tx, client) =>
        ledgerService.appendEntry(client, {
            clubId: db.clubId,
            entryType,
            amount: entryType === "Expense" ? toNumeric(-cents) : toNumeric(cents),
            description: String(description).trim(),
            postedBy: actor.userId
        })
    );

    await audit(entryType === "Interest" ? "distribution.recordInterest" : "distribution.recordExpense", "Success", {
        detail: `${actor.fullName} recorded ${entryType.toLowerCase()} of R${toNumeric(cents)}: ${String(description).trim()}. Pool balance now R${entry.resultingBalance}.`,
        targetType: "ledger_entry",
        targetId: entry.entryId
    });
    return { entryId: entry.entryId, amount: entry.amount, resultingBalance: entry.resultingBalance };
}

const recordInterest = (db, body, ctx) => recordFinancialEntry(db, "Interest", body, ctx);
const recordExpense = (db, body, ctx) => recordFinancialEntry(db, "Expense", body, ctx);

// ---------------------------------------------------------------------------
// initiateDistribution()  REQ-79, REQ-82
// ---------------------------------------------------------------------------

async function initiateDistribution(db, { actor, audit }) {
    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        const club = await repo.lockClub(tx);

        const notYet = requireAccumulatingForNow(club.club_type);
        if (notYet) return { refused: notYet, detail: {} };

        if (await repo.openDistribution(tx)) {
            return { refused: "A distribution is already waiting for approval. It must be approved or cancelled before another is started.", detail: { requirement: "REQ-64" } };
        }

        const a = await computeFreshAssessment(tx);
        if (!a.result.eligible) {
            return {
                refused: a.result.refusals.map((r) => r.message).join(" "),
                detail: { requirement: [...new Set(a.result.refusals.map((r) => r.requirement))].join(", "), refusals: a.result.refusals }
            };
        }

        const constitution = a.constitution;
        const assessment = {
            yearEndDate: a.yearEndDate, periodStart: a.periodStart,
            interest: toNumeric(a.interestCents), expenses: toNumeric(a.expenseCents),
            poolBalance: toNumeric(a.poolCents),
            totals: { totalDistributed: toNumeric(a.result.shares.totalFinalCents) },
            shares: a.result.shares
        };

        const created = await repo.insertDistribution(tx, {
            yearEndDate: a.yearEndDate, periodStart: a.periodStart, periodEnd: a.yearEndDate,
            constitutionVersion: constitution.version,
            totalContributions: toNumeric(a.result.shares.perMember.reduce((s, m) => s + m.capturedCents, 0)),
            totalPenalties: toNumeric(a.result.shares.perMember.reduce((s, m) => s + m.penaltyCents, 0)),
            totalInterest: toNumeric(a.interestCents),
            totalExpenses: toNumeric(a.expenseCents),
            totalDistributed: toNumeric(a.result.shares.totalFinalCents),
            poolAtComputation: toNumeric(a.poolCents),
            assessment,
            initiatedBy: actor.userId
        });

        const rule = describeDistributionRule({ constitutionVersion: constitution.version, yearEndDate: a.yearEndDate });
        for (const m of a.result.shares.perMember) {
            await repo.insertMemberPayout(tx, {
                memberId: m.memberId, amount: toNumeric(m.finalCents), distributionId: created.distribution_id,
                constitutionVersion: constitution.version, rule,
                assessment: { finalAmount: toNumeric(m.finalCents), captured: toNumeric(m.capturedCents), penalties: toNumeric(m.penaltyCents) },
                initiatedBy: actor.userId
            });
        }

        return { distributionId: created.distribution_id, a, memberCount: a.result.shares.perMember.length };
    });

    if (outcome.refused) {
        await refuse(audit, "distribution.initiate", outcome.refused, outcome.detail);
    }

    await audit("distribution.initiate", "Success", {
        detail:
            `${actor.fullName} initiated the year-end distribution for ${outcome.a.yearEndDate}: ` +
            `${outcome.memberCount} members, totalling R${toNumeric(outcome.a.result.shares.totalFinalCents)}. ` +
            "It is waiting for the Chairperson's approval.",
        targetType: "distribution",
        targetId: outcome.distributionId
    });
    return await getDistribution(db, outcome.distributionId);
}

// ---------------------------------------------------------------------------
// approveDistribution()  REQ-64, REQ-67, REQ-81
// ---------------------------------------------------------------------------

async function approveDistribution(db, distributionId, { actor, audit }) {
    const outcome = await withClubTransaction(db.clubId, async (tx, client) => {
        await repo.lockClub(tx);

        const d = await repo.getDistribution(tx, distributionId, { forUpdate: true });
        if (!d) return { notFound: true };

        if (d.status !== "Initiated") {
            return { refused: `This distribution is ${d.status.toLowerCase()} and cannot be approved.`, detail: { requirement: "REQ-64" }, d };
        }
        if (d.initiated_by === actor.userId) {
            return { refused: "You initiated this distribution, so you cannot approve it. Another officer must approve it (REQ-64).", detail: { requirement: "REQ-64", rule: "BR-2" }, d };
        }

        const v = await verifyFrozenAssessment(tx, d);
        if (!v.eligible) {
            return { refused: v.refusals.map((r) => r.message).join(" "), detail: { requirement: [...new Set(v.refusals.map((r) => r.requirement))].join(", "), refusals: v.refusals }, d };
        }

        const members = await repo.listMemberPayouts(tx, distributionId);
        const byId = new Map(members.map((m) => [m.member_id, m]));
        let resultingBalance = null;
        for (const share of d.assessment_at_initiation.shares.perMember) {
            const p = byId.get(share.memberId);
            const entry = await ledgerService.appendEntry(client, {
                clubId: db.clubId,
                memberId: share.memberId,
                entryType: "Payout",
                amount: toNumeric(-share.finalCents),
                description: `Year-end distribution, ${d.year_end_date}`,
                postedBy: actor.userId,
                payoutId: p.payout_id
            });
            await repo.markMemberPayoutApproved(tx, p.payout_id, { approvedBy: actor.userId, assessment: { postedAmount: entry.amount } });
            resultingBalance = entry.resultingBalance;
        }

        const assessmentAtApproval = { checkedAgainstPool: toNumeric(v.poolCents), refusals: [] };
        await repo.markApproved(tx, distributionId, { approvedBy: actor.userId, assessment: assessmentAtApproval });

        return { d, memberCount: members.length, resultingBalance };
    });

    if (outcome.notFound) throw new NotFound("That distribution was not found in this club.");
    if (outcome.refused) {
        await refuse(audit, "distribution.approve", outcome.refused, outcome.detail, { id: distributionId });
    }

    await audit("distribution.approve", "Success", {
        detail:
            `${actor.fullName} approved the year-end distribution for ${outcome.d.year_end_date}, initiated by ` +
            `${outcome.d.initiated_by_name}. ${outcome.memberCount} payments posted. Pool balance now R${outcome.resultingBalance}.`,
        targetType: "distribution",
        targetId: distributionId
    });
    return await getDistribution(db, distributionId);
}

// ---------------------------------------------------------------------------
// cancelDistribution()  REQ-70
// ---------------------------------------------------------------------------

async function cancelDistribution(db, distributionId, { reason }, { actor, audit }) {
    if (!reason || !String(reason).trim()) throw new BadRequest("Record why the distribution is being cancelled.");

    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        await repo.lockClub(tx);
        const d = await repo.getDistribution(tx, distributionId, { forUpdate: true });
        if (!d) return { notFound: true };
        if (d.status !== "Initiated") {
            return { refused: `This distribution is ${d.status.toLowerCase()}. Only one that has been initiated and not yet approved can be cancelled.`, d };
        }
        const members = await repo.listMemberPayouts(tx, distributionId);
        for (const m of members) {
            await repo.markMemberPayoutCancelled(tx, m.payout_id, { cancelledBy: actor.userId, reason: String(reason).trim() });
        }
        await repo.markCancelled(tx, distributionId, { cancelledBy: actor.userId, reason: String(reason).trim() });
        return { d };
    });

    if (outcome.notFound) throw new NotFound("That distribution was not found in this club.");
    if (outcome.refused) {
        await refuse(audit, "distribution.cancel", outcome.refused, { requirement: "REQ-70" }, { id: distributionId });
    }
    await audit("distribution.cancel", "Success", {
        detail: `${actor.fullName} cancelled the year-end distribution for ${outcome.d.year_end_date}. Reason: ${String(reason).trim()}`,
        targetType: "distribution",
        targetId: distributionId
    });
    return await getDistribution(db, distributionId);
}

module.exports = {
    recordInterest, recordExpense,
    previewNextDistribution,
    listDistributions, getDistribution,
    initiateDistribution, approveDistribution, cancelDistribution
};