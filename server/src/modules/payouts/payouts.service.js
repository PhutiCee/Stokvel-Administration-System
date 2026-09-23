"use strict";

/**
 * Payout service. Use Case 3, REQ-64 to REQ-70. SDD: Payout.
 *
 *     assessEligibility()   is this payout allowed, and on what basis   REQ-65, REQ-66, REQ-67, REQ-72
 *     initiatePayout()      the Treasurer proposes it                   REQ-64, REQ-68
 *     approvePayout()       a different officer authorises and posts    REQ-64, REQ-66, REQ-67, REQ-68, REQ-73
 *     cancelPayout()        the Treasurer withdraws it                  REQ-70
 *
 * What this file covers: rotation payouts, the payout every Rotating club makes
 * at the end of a cycle. Year-end distributions (REQ-79 to REQ-82) and burial
 * claims (REQ-83 to REQ-88) use the same authorisation and posting, and are
 * added on top of it. Until then those clubs are refused with a message that
 * says so.
 *
 * How a rotation payout works. The member at the head of the queue receives the
 * contributions captured for the earliest cycle that has not yet been paid out,
 * once that cycle's due date has passed. The amount is fixed when the Treasurer
 * initiates. It is checked again, against the facts of that moment, when the
 * Chairperson approves, because approval is when money leaves the pool.
 *
 * Dual authorisation is enforced here (the same account cannot do both) and by
 * a CHECK constraint on the payout table.
 *
 * No Express in this file.
 */

const repo = require("./payouts.repo");
const queueService = require("../queue/queue.service");
const queueRepo = require("../queue/queue.repo");
const constitutionService = require("../constitution/constitution.service");
const ledgerService = require("../ledger/ledger.service");
const { assessRotationPayout, describeRotationRule } = require("../../rules/payouts");
const queueRules = require("../../rules/queue");
const { withClubTransaction } = require("../../db/tx");
const { toCents, toNumeric } = require("../../lib/money");
const { todayIso } = require("../../lib/dates");
const { BadRequest, NotFound, RuleRefusal } = require("../../lib/errors");

const rands = (cents) => `R${toNumeric(cents)}`;

async function refuse(audit, action, message, detail, target = {}) {
    await audit(action, "Refused", {
        detail: `Refused: ${message}`,
        targetType: target.type || "payout",
        targetId: target.id || null
    });
    throw new RuleRefusal(message, detail);
}

function requireRotatingForNow(clubType) {
    if (clubType === "Rotating") return null;
    if (clubType === "Accumulating") {
        return "An accumulating club pays out once a year as a distribution shared among all members, not one member at a time (REQ-79 to REQ-82).";
    }
    return "A burial society pays out on an assessed claim, not on rotation (REQ-83 to REQ-88).";
}

// ---------------------------------------------------------------------------
// assessEligibility()  REQ-65, REQ-66, REQ-67, REQ-72
// ---------------------------------------------------------------------------

/**
 * Gathers the facts and applies the rules. Used for a preview, at initiation
 * and again at approval.
 *
 * @param {object} db a club database or a club transaction
 * @param {object} args
 * @param {string|null} args.memberId    the intended recipient. Omit for whoever is at the head.
 * @param {object|null} args.payout      an existing payout being re-assessed at approval. Its cycle,
 *                                       amount and recipient are taken as fixed.
 */
async function assessEligibility(db, { memberId = null, payout = null } = {}) {
    const today = todayIso();
    const club = await db.one(`SELECT club_type FROM club WHERE club_id = $1`, [db.clubId]);
    const constitution = await constitutionService.getVersionInForceOn(db, today);

    const rows = await queueRepo.listQueueRows(db);
    const order = queueService.rowsToOrder(rows);
    const byId = new Map(rows.map((r) => [r.member_id, r]));
    const headRow = order.length ? byId.get(order[0]) : null;

    // The recipient: the payout's own, the one asked for, or the head.
    const recipientId = payout ? payout.member_id : (memberId || headRow?.member_id || null);
    let recipient = null;
    if (recipientId) {
        const m = await repo.getMember(db, recipientId);
        if (!m) throw new NotFound("That member was not found in this club.");
        recipient = { memberId: m.member_id, fullName: m.full_name, standing: m.standing, position: m.queue_position };
    }

    // The cycle: the payout's own, or the earliest not yet paid out.
    let cycle = null;
    if (payout) {
        const c = await repo.getCycle(db, payout.cycle_id);
        cycle = { cycleId: c.cycle_id, sequenceNumber: c.sequence_number, dueDate: c.due_date };
    } else {
        const c = await queueRepo.earliestUnpaidCycle(db);
        if (c) cycle = { cycleId: c.cycle_id, sequenceNumber: c.sequence_number, dueDate: c.due_date };
    }

    let amountCents = 0;
    let totals = null;
    if (cycle) {
        totals = await repo.cycleTotals(db, cycle.cycleId);
        amountCents = payout ? toCents(payout.amount) : toCents(totals.captured);
    }

    const poolCents = toCents((await ledgerService.getPoolBalance(db)).balance);

    // REQ-77: a ruling to pay this member notwithstanding arrears.
    let arrearsRuling = null;
    if (recipient && recipient.standing === "In arrears") {
        arrearsRuling = payout
            ? (payout.arrears_decision_id ? { decisionId: payout.arrears_decision_id } : null)
            : await queueRepo.usablePayRuling(db, recipient.memberId);
        if (arrearsRuling && !arrearsRuling.decisionId) arrearsRuling = { ...arrearsRuling, decisionId: arrearsRuling.decision_id };
    }

    const result = assessRotationPayout({
        clubType: club.club_type,
        recipient,
        head: headRow ? { memberId: headRow.member_id, fullName: headRow.full_name } : null,
        amountCents,
        poolCents,
        cycle,
        today,
        arrearsRuling
    });

    const shortCents = totals ? toCents(totals.expected) - toCents(totals.captured) : 0;
    const notes = [...result.notes];
    if (totals && totals.members_short > 0 && shortCents > 0) {
        notes.push(
            `${totals.members_short} member(s) have not paid this cycle in full. The pot is ` +
            `${rands(shortCents)} short of the ${rands(toCents(totals.expected))} expected.`
        );
    }

    return {
        assessedOn: today,
        eligible: result.eligible,
        refusals: result.refusals,
        chairpersonOptions: result.chairpersonOptions,
        notes,
        payoutType: "Rotation",
        recipient,
        head: headRow ? { memberId: headRow.member_id, fullName: headRow.full_name } : null,
        cycle: cycle && {
            ...cycle,
            expectedAmount: totals ? totals.expected : null,
            capturedAmount: totals ? totals.captured : null,
            membersShort: totals ? totals.members_short : null
        },
        amount: toNumeric(amountCents),
        constitutionVersion: constitution.version,
        rule: cycle
            ? describeRotationRule({
                constitutionVersion: constitution.version,
                payoutOrderMethod: constitution.payoutOrderMethod,
                cycleSequence: cycle.sequenceNumber
            })
            : "No cycle is waiting to be paid out.",
        // REQ-65: the resulting pool balance.
        poolBalance: toNumeric(poolCents),
        poolBalanceAfter: toNumeric(poolCents - amountCents),
        arrearsRuling: arrearsRuling
            ? { decisionId: arrearsRuling.decisionId, reason: arrearsRuling.reason ?? null }
            : null,
        _amountCents: amountCents
    };
}

/** The assessment shown to a person, without the internal fields. */
function publicAssessment(a) {
    const { _amountCents, ...rest } = a;
    return rest;
}

/** What would happen if the Treasurer initiated a payout now. Nothing is recorded. */
async function previewNextPayout(db) {
    return publicAssessment(await assessEligibility(db, {}));
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function presentPayout(p) {
    return {
        payoutId: p.payout_id,
        status: p.status,
        payoutType: p.payout_type,
        amount: p.amount,
        recipient: { memberId: p.member_id, fullName: p.recipient_name },
        cycle: p.cycle_id ? { cycleId: p.cycle_id, sequenceNumber: p.cycle_sequence } : null,
        constitutionVersion: p.constitution_version,
        rule: p.eligibility_rule_applied,
        initiated: { by: p.initiated_by_name, userId: p.initiated_by, at: p.initiated_at },
        approved: p.approved_by ? { by: p.approved_by_name, userId: p.approved_by, at: p.approved_at } : null,
        cancelled: p.cancelled_by
            ? { by: p.cancelled_by_name, userId: p.cancelled_by, at: p.cancelled_at, reason: p.cancel_reason }
            : null,
        assessmentAtInitiation: p.assessment_at_initiation,
        assessmentAtApproval: p.assessment_at_approval,
        ledgerEntryId: p.ledger_entry_id
    };
}

async function listPayouts(db) {
    return (await repo.listPayouts(db)).map(presentPayout);
}

/**
 * REQ-65: the payout with, while it is waiting, the assessment as it stands
 * NOW. That is what the Chairperson is shown at the point of approval: the
 * recipient, the amount, the rule and the resulting pool balance.
 */
async function getPayout(db, payoutId) {
    const p = await repo.getPayout(db, payoutId);
    if (!p) throw new NotFound("That payout was not found in this club.");
    const out = presentPayout(p);
    if (p.status === "Initiated") {
        out.assessmentNow = publicAssessment(await assessEligibility(db, { payout: p }));
    }
    return out;
}

// ---------------------------------------------------------------------------
// initiatePayout()  REQ-64, REQ-68, REQ-72
// ---------------------------------------------------------------------------

async function initiatePayout(db, { memberId = null } = {}, { actor, audit }) {
    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        const club = await queueRepo.lockClub(tx);

        const notYet = requireRotatingForNow(club.club_type);
        if (notYet) return { refused: notYet, detail: { requirement: "REQ-71" } };

        if (await repo.openRotationPayout(tx)) {
            return {
                refused: "A payout is already waiting for approval. It must be approved or cancelled before another is started.",
                detail: { requirement: "REQ-64" }
            };
        }

        const a = await assessEligibility(tx, { memberId });
        if (!a.eligible) {
            return {
                refused: a.refusals.map((r) => r.message).join(" "),
                detail: { requirement: [...new Set(a.refusals.map((r) => r.requirement))].join(", "), refusals: a.refusals, chairpersonOptions: a.chairpersonOptions, assessment: publicAssessment(a) }
            };
        }

        const created = await repo.insertPayout(tx, {
            memberId: a.recipient.memberId,
            payoutType: "Rotation",
            amount: a.amount,
            cycleId: a.cycle.cycleId,
            constitutionVersion: a.constitutionVersion,
            rule: a.rule,
            assessment: publicAssessment(a),
            arrearsDecisionId: a.arrearsRuling ? a.arrearsRuling.decisionId : null,
            initiatedBy: actor.userId
        });
        return { payoutId: created.payout_id, a };
    });

    if (outcome.refused) {
        await refuse(audit, "payout.initiate", outcome.refused, outcome.detail);
    }

    await audit("payout.initiate", "Success", {
        detail:
            `${actor.fullName} initiated a rotation payout of R${outcome.a.amount} to ${outcome.a.recipient.fullName} ` +
            `for cycle ${outcome.a.cycle.sequenceNumber}, under constitution version ${outcome.a.constitutionVersion}. ` +
            "It is waiting for the Chairperson's approval.",
        targetType: "payout",
        targetId: outcome.payoutId
    });
    return presentPayout(await repo.getPayout(db, outcome.payoutId));
}

// ---------------------------------------------------------------------------
// approvePayout()  REQ-64, REQ-66, REQ-67, REQ-68, REQ-73
// ---------------------------------------------------------------------------

async function approvePayout(db, payoutId, { actor, audit }) {
    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        // The club row first, always, so payouts, exchanges and rulings queue up
        // behind one another instead of interleaving.
        await queueRepo.lockClub(tx);

        const p = await repo.getPayout(tx, payoutId, { forUpdate: true });
        if (!p) return { notFound: true };

        if (p.status !== "Initiated") {
            return { refused: `This payout is ${p.status.toLowerCase()} and cannot be approved.`, detail: { requirement: "REQ-64" }, p };
        }

        // REQ-64. Two distinct accounts.
        if (p.initiated_by === actor.userId) {
            return {
                refused: "You initiated this payout, so you cannot approve it. Another officer must approve it (REQ-64).",
                detail: { requirement: "REQ-64", rule: "BR-2" },
                p
            };
        }

        // Assessed against the facts of THIS moment. The payout's own recipient,
        // cycle and amount are fixed; the queue, standing and pool are not.
        const a = await assessEligibility(tx, { payout: p });
        if (!a.eligible) {
            return {
                refused: a.refusals.map((r) => r.message).join(" "),
                detail: { requirement: [...new Set(a.refusals.map((r) => r.requirement))].join(", "), refusals: a.refusals, assessment: publicAssessment(a) },
                p
            };
        }

        const amountCents = a._amountCents;
        const entry = await ledgerService.appendEntry(tx, {
            clubId: db.clubId,
            memberId: p.member_id,
            entryType: "Payout",
            amount: toNumeric(-amountCents),
            description: `Rotation payout, cycle ${p.cycle_sequence}`,
            reference: `payout ${p.payout_id}`,
            postedBy: actor.userId,
            payoutId: p.payout_id
        });

        await repo.markApproved(tx, payoutId, { approvedBy: actor.userId, assessment: publicAssessment(a) });

        // REQ-73.
        await queueService.advanceAfterPayout(tx, p.member_id);

        return { p, a, entry };
    });

    if (outcome.notFound) throw new NotFound("That payout was not found in this club.");
    if (outcome.refused) {
        await refuse(audit, "payout.approve", outcome.refused, outcome.detail, { type: "payout", id: payoutId });
    }

    const { p, a, entry } = outcome;
    await audit("payout.approve", "Success", {
        detail:
            `${actor.fullName} approved the payout of R${a.amount} to ${p.recipient_name}, initiated by ` +
            `${p.initiated_by_name}, and it was posted to the ledger. Pool balance now R${entry.resultingBalance}. ` +
            `${p.recipient_name} moved to the end of the queue.`,
        targetType: "payout",
        targetId: payoutId
    });

    // REQ-69: telling the recipient belongs to the notification service, which is
    // built separately. The payout is complete without it.
    const posted = presentPayout(await repo.getPayout(db, payoutId));
    return { payout: posted, ledgerEntry: { entryId: entry.entryId, amount: entry.amount, resultingBalance: entry.resultingBalance } };
}

// ---------------------------------------------------------------------------
// cancelPayout()  REQ-70
// ---------------------------------------------------------------------------

async function cancelPayout(db, payoutId, { reason }, { actor, audit }) {
    if (!reason || !String(reason).trim()) {
        throw new BadRequest("Record why the payout is being cancelled.");
    }

    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        await queueRepo.lockClub(tx);
        const p = await repo.getPayout(tx, payoutId, { forUpdate: true });
        if (!p) return { notFound: true };
        if (p.status !== "Initiated") {
            return { refused: `This payout is ${p.status.toLowerCase()}. Only a payout that has been initiated and not yet approved can be cancelled.`, p };
        }
        await repo.markCancelled(tx, payoutId, { cancelledBy: actor.userId, reason: String(reason).trim() });
        return { p };
    });

    if (outcome.notFound) throw new NotFound("That payout was not found in this club.");
    if (outcome.refused) {
        await refuse(audit, "payout.cancel", outcome.refused, { requirement: "REQ-70" }, { type: "payout", id: payoutId });
    }

    await audit("payout.cancel", "Success", {
        detail: `${actor.fullName} cancelled the payout of R${outcome.p.amount} to ${outcome.p.recipient_name}. Reason: ${String(reason).trim()}`,
        targetType: "payout",
        targetId: payoutId
    });
    return presentPayout(await repo.getPayout(db, payoutId));
}

module.exports = {
    assessEligibility,
    previewNextPayout,
    listPayouts,
    getPayout,
    initiatePayout,
    approvePayout,
    cancelPayout
};