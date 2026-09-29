"use strict";

/**
 * Payout queue service. Use Case 3, REQ-71 to REQ-78. SDD: PayoutQueue.
 *
 *     getQueue()          the queue, with projected dates          REQ-71, REQ-78
 *     getOwnPosition()    one member's place and date              REQ-78
 *     establishQueue()    set the order by the constitution        REQ-71
 *     requestSwap()       ask to exchange places                   REQ-74
 *     consentToSwap()     the other member's answer                REQ-75
 *     approveSwap()       the Chairperson effects it               REQ-75, REQ-76
 *     rejectSwap()        the Chairperson refuses it
 *     cancelSwap()        the requester withdraws it
 *     resolveArrears()    defer, or pay notwithstanding            REQ-77
 *
 * And for other modules, inside their own transaction:
 *
 *     advanceAfterPayout()  the recipient goes to the end          REQ-73
 *     removeFromQueue()     exit or expulsion closes the gap       REQ-76
 *
 * The order itself is computed by rules/queue.js. This file reads it, applies a
 * rule and writes it back inside one transaction, with the club row locked so
 * that two changes to the queue cannot interleave.
 *
 * No Express in this file.
 */

const crypto = require("node:crypto");
const repo = require("./queue.repo");
const constitutionService = require("../constitution/constitution.service");
const rules = require("../../rules/queue");
const { withClubTransaction } = require("../../db/tx");
const { addCycles } = require("../../lib/dates");
const { BadRequest, NotFound, RuleRefusal } = require("../../lib/errors");

const NOT_PAYABLE = ["Suspended", "Expelled", "Exited"];

function requireRotating(club) {
    if (club.club_type !== "Rotating") {
        throw new RuleRefusal(
            "Only a Rotating club has a payout queue.",
            { requirement: "REQ-71" }
        );
    }
}

function rowsToOrder(rows) {
    return rules.orderOf(rows.map((r) => ({ memberId: r.member_id, position: r.queue_position })));
}

async function refuse(audit, action, message, detail, target = {}) {
    await audit(action, "Refused", {
        detail: `Refused: ${message}`,
        targetType: target.type || "queue",
        targetId: target.id || null
    });
    throw new RuleRefusal(message, detail);
}

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

/** The date the member at the head is due to be paid, and the cycle it is for. */
async function nextPayout(db, frequency) {
    const unpaid = await repo.earliestUnpaidCycle(db);
    if (unpaid) {
        return { cycleId: unpaid.cycle_id, sequenceNumber: unpaid.sequence_number, dueDate: unpaid.due_date };
    }
    // Every cycle so far has been paid out. The next payout falls due at the end
    // of the next cycle, one cycle after the latest.
    const latest = await repo.latestCycle(db);
    if (latest) {
        return { cycleId: null, sequenceNumber: latest.sequence_number + 1, dueDate: addCycles(latest.due_date, 1, frequency) };
    }
    return null;
}

/** The member at the head, if the queue advancing is blocked, and what the Chairperson may do about it. */
async function rulingNeeded(db, headRow) {
    if (!headRow) return null;
    if (headRow.standing === "Suspended") {
        return { memberId: headRow.member_id, fullName: headRow.full_name, standing: headRow.standing, options: ["defer"] };
    }
    if (headRow.standing === "In arrears") {
        const ruling = await repo.usablePayRuling(db, headRow.member_id);
        if (!ruling) {
            return { memberId: headRow.member_id, fullName: headRow.full_name, standing: headRow.standing, options: ["defer", "pay"] };
        }
    }
    return null;
}

function presentSwap(s) {
    return {
        swapId: s.swap_id,
        status: s.status,
        requester: { memberId: s.requester_member_id, fullName: s.requester_name, positionAtRequest: s.requester_position_at_request },
        counterparty: { memberId: s.counterparty_member_id, fullName: s.counterparty_name, positionAtRequest: s.counterparty_position_at_request },
        requestedAt: s.requested_at,
        consentGiven: s.consent_given,
        consentAt: s.consent_at,
        decidedAt: s.decided_at,
        decisionReason: s.decision_reason,
        positionsAfter: s.requester_position_after === null
            ? null
            : { requester: s.requester_position_after, counterparty: s.counterparty_position_after }
    };
}

const OFFICERS = ["Treasurer", "Secretary", "Chairperson"];

/**
 * REQ-71 and REQ-78. Every member may see the whole queue: it is the shared
 * timetable of who is paid when, and hiding it would invite the suspicion the
 * rotation exists to remove. What a member does not see is other people's
 * exchange requests.
 */
async function getQueue(db, { viewer }) {
    const club = await db.one(`SELECT club_type FROM club WHERE club_id = $1`, [db.clubId]);
    if (club.club_type !== "Rotating") {
        return { applicable: false, clubType: club.club_type, entries: [] };
    }

    const constitution = await constitutionService.getVersionInForceOn(db);
    const rows = await repo.listQueueRows(db);
    const order = rowsToOrder(rows);
    const byId = new Map(rows.map((r) => [r.member_id, r]));
    const next = await nextPayout(db, constitution.cycleFrequency);
    const dates = rules.projectHeadDates(order, next?.dueDate ?? null, constitution.cycleFrequency);

    const entries = order.map((memberId, i) => {
        const r = byId.get(memberId);
        return {
            position: i + 1,
            memberId,
            fullName: r.full_name,
            standing: r.standing,
            projectedDate: dates.get(memberId),
            isYou: memberId === viewer.memberId
        };
    });

    const headRow = rows.length ? byId.get(order[0]) : null;
    const allSwaps = await repo.listSwaps(db, { openOnly: true });
    const visible = OFFICERS.includes(viewer.role)
        ? allSwaps
        : allSwaps.filter((s) => s.requester_member_id === viewer.memberId || s.counterparty_member_id === viewer.memberId);

    return {
        applicable: true,
        clubType: club.club_type,
        payoutOrderMethod: constitution.payoutOrderMethod,
        cycleFrequency: constitution.cycleFrequency,
        nextPayout: next,
        head: entries[0] ? { memberId: entries[0].memberId, fullName: entries[0].fullName, standing: entries[0].standing } : null,
        needsRuling: await rulingNeeded(db, headRow),
        entries,
        openSwaps: visible.map(presentSwap)
    };
}

/** REQ-78: a member's own position and the date they reach the head. */
async function getOwnPosition(db, { viewer }) {
    const queue = await getQueue(db, { viewer });
    if (!queue.applicable) return { applicable: false, clubType: queue.clubType };
    const mine = queue.entries.find((e) => e.isYou);
    if (!mine) return { applicable: true, inQueue: false };
    return {
        applicable: true,
        inQueue: true,
        position: mine.position,
        of: queue.entries.length,
        membersAhead: mine.position - 1,
        projectedDate: mine.projectedDate,
        standing: mine.standing,
        cycleFrequency: queue.cycleFrequency,
        openSwaps: queue.openSwaps
    };
}

// ---------------------------------------------------------------------------
// REQ-71: establishing the order
// ---------------------------------------------------------------------------

/**
 * Sets the order according to the payout order method in the constitution in
 * force today.
 *
 *   Random draw   drawn here, with the operating system's random source
 *   Seniority     earliest join date first
 *   Negotiated    the order the members agreed, supplied by the Chairperson
 *
 * Refused once anyone has been paid. From then on the order is a record of who
 * has had their turn, and re-drawing it would let the Chairperson put a member
 * back at the head.
 */
async function establishQueue(db, { order = null } = {}, { actor, audit }) {
    const result = await withClubTransaction(db.clubId, async (tx) => {
        const club = await repo.lockClub(tx);
        requireRotating(club);

        if (await repo.hasPaidAnyone(tx)) {
            return { refused: "The order cannot be set again because a payout has already been made. From then on it records who has had their turn." };
        }

        const constitution = await constitutionService.getVersionInForceOn(tx);
        const candidates = await repo.listDrawCandidates(tx);
        const ids = candidates.map((c) => c.member_id);
        if (ids.length === 0) return { refused: "There is nobody to put in the queue." };

        let newOrder;
        switch (constitution.payoutOrderMethod) {
            case "Random draw":
                newOrder = rules.drawOrder(ids, (max) => crypto.randomInt(max));
                break;
            case "Seniority":
                newOrder = rules.seniorityOrder(candidates.map((c) => ({
                    memberId: c.member_id, joinDate: c.join_date, registeredAt: c.registered_at.toISOString()
                })));
                break;
            case "Negotiated": {
                const check = rules.checkProposedOrder(ids, order);
                if (!check.valid) return { badRequest: check.error };
                newOrder = order;
                break;
            }
            default:
                return { refused: "The constitution does not state a payout order method." };
        }

        await repo.clearPositionsExcept(tx, ids);
        await repo.setPositions(tx, rules.withPositions(newOrder));

        const rows = await repo.listQueueRows(tx);
        return { method: constitution.payoutOrderMethod, version: constitution.version, rows };
    });

    if (result.badRequest) throw new BadRequest(result.badRequest);
    if (result.refused) {
        await refuse(audit, "queue.establish", result.refused, { requirement: "REQ-71" });
    }

    await audit("queue.establish", "Success", {
        detail:
            `${actor.fullName} set the payout order by ${result.method} (constitution version ${result.version}): ` +
            result.rows.map((r) => `${r.queue_position} ${r.full_name}`).join(", "),
        targetType: "queue",
        targetId: null
    });
    return { method: result.method, entries: result.rows.map((r) => ({ position: r.queue_position, memberId: r.member_id, fullName: r.full_name })) };
}

// ---------------------------------------------------------------------------
// Used by the payout and member modules, inside their own transaction
// ---------------------------------------------------------------------------

/** REQ-73: the member just paid goes to the end. Everyone else moves up one. */
async function advanceAfterPayout(tx, recipientMemberId) {
    const order = rowsToOrder(await repo.listQueueRows(tx));
    await repo.setPositions(tx, rules.withPositions(rules.moveToEnd(order, recipientMemberId)));
}

/**
 * REQ-76: a member exits or is expelled. They leave the queue, the gap closes,
 * and nobody else changes order. Called by the exit and expulsion flows inside
 * their transaction.
 */
async function removeFromQueue(tx, memberId) {
    const order = rowsToOrder(await repo.listQueueRows(tx));
    if (!order.includes(memberId)) return;
    await repo.clearPosition(tx, memberId);
    await repo.setPositions(tx, rules.withPositions(rules.removeMember(order, memberId)));
}

// ---------------------------------------------------------------------------
// REQ-74, REQ-75, REQ-76: exchanging places
// ---------------------------------------------------------------------------

async function requestSwap(db, { withMemberId }, { actor, audit }) {
    if (!withMemberId) throw new BadRequest("Name the member you want to exchange places with.");

    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        const club = await repo.lockClub(tx);
        requireRotating(club);

        if (!actor.memberId) return { refused: "You are not a member of this club." };
        if (withMemberId === actor.memberId) {
            return { refused: "You cannot exchange places with yourself." };
        }

        const me = await repo.getMemberRow(tx, actor.memberId);
        const other = await repo.getMemberRow(tx, withMemberId);
        if (!other) return { notFound: true };

        if (me.queue_position === null) return { refused: "You are not in the payout queue." };
        if (other.queue_position === null) return { refused: `${other.full_name} is not in the payout queue.` };
        for (const m of [me, other]) {
            if (NOT_PAYABLE.includes(m.standing)) {
                return { refused: `${m.full_name} is ${m.standing.toLowerCase()} and cannot exchange places.` };
            }
        }

        const open = await repo.openSwapsTouching(tx, [me.member_id, other.member_id]);
        if (open.length) {
            return { refused: "One of you is already part of an exchange that has not been settled. It must be completed, declined or withdrawn first." };
        }

        const created = await repo.insertSwap(tx, {
            requesterMemberId: me.member_id,
            counterpartyMemberId: other.member_id,
            requestedBy: actor.userId,
            requesterPosition: me.queue_position,
            counterpartyPosition: other.queue_position
        });
        return { swapId: created.swap_id, me, other };
    });

    if (outcome.notFound) throw new NotFound("That member was not found in this club.");
    if (outcome.refused) {
        await refuse(audit, "queue.swapRequest", outcome.refused, { requirement: "REQ-74" });
    }

    await audit("queue.swapRequest", "Success", {
        detail: `${actor.fullName} asked to exchange payout positions with ${outcome.other.full_name} ` +
                `(${outcome.me.queue_position} and ${outcome.other.queue_position}).`,
        targetType: "queue_swap",
        targetId: outcome.swapId
    });
    return presentSwap(await repo.getSwap(db, outcome.swapId));
}

/** REQ-75: only the member who was asked can answer, and their answer is recorded. */
async function consentToSwap(db, swapId, { consent }, { actor, audit }) {
    if (typeof consent !== "boolean") {
        throw new BadRequest("Say whether you consent, with consent: true or consent: false.");
    }

    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        await repo.lockClub(tx);
        const swap = await repo.getSwap(tx, swapId, { forUpdate: true });
        if (!swap) return { notFound: true };

        if (swap.counterparty_member_id !== actor.memberId) {
            return { refused: `Only ${swap.counterparty_name} can consent to or refuse this exchange.`, swap };
        }
        if (swap.status !== "Pending consent") {
            return { refused: `This exchange is ${swap.status.toLowerCase()} and no longer waiting for your answer.`, swap };
        }

        await repo.recordConsent(tx, swapId, { consent, consentBy: actor.userId });
        return { swap };
    });

    if (outcome.notFound) throw new NotFound("That exchange was not found in this club.");
    if (outcome.refused) {
        await refuse(audit, "queue.swapConsent", outcome.refused, { requirement: "REQ-75" }, { type: "queue_swap", id: swapId });
    }

    await audit("queue.swapConsent", "Success", {
        detail: `${actor.fullName} ${consent ? "consented to" : "declined"} exchanging positions with ${outcome.swap.requester_name}.`,
        targetType: "queue_swap",
        targetId: swapId
    });
    return presentSwap(await repo.getSwap(db, swapId));
}

/**
 * REQ-75: the exchange happens only when the other member has consented AND the
 * Chairperson approves. REQ-76: the queue is recomputed, and the members not
 * involved keep their order relative to each other.
 */
async function approveSwap(db, swapId, { actor, audit }) {
    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        const club = await repo.lockClub(tx);
        requireRotating(club);

        const swap = await repo.getSwap(tx, swapId, { forUpdate: true });
        if (!swap) return { notFound: true };

        if (swap.status === "Pending consent") {
            return { refused: `${swap.counterparty_name} has not yet consented. An exchange needs their consent before it can be approved.`, swap };
        }
        if (swap.status !== "Pending approval") {
            return { refused: `This exchange is ${swap.status.toLowerCase()} and cannot be approved.`, swap };
        }
        if (swap.consent_given !== true) {
            return { refused: "The other member has not consented.", swap };
        }

        // The order must not change under a payout that is waiting to be approved.
        if (await repo.hasOpenRotationPayout(tx)) {
            return { refused: "A payout is waiting for approval. Approve or cancel it before the order is changed.", swap };
        }

        const rows = await repo.listQueueRows(tx);
        const byId = new Map(rows.map((r) => [r.member_id, r]));
        const a = byId.get(swap.requester_member_id);
        const b = byId.get(swap.counterparty_member_id);
        if (!a || !b) {
            return { refused: "One of the two members is no longer in the queue, so the exchange cannot go ahead.", swap };
        }
        for (const m of [a, b]) {
            if (NOT_PAYABLE.includes(m.standing)) {
                return { refused: `${m.full_name} is ${m.standing.toLowerCase()} and cannot exchange places.`, swap };
            }
        }

        const order = rowsToOrder(rows);
        const next = rules.swap(order, a.member_id, b.member_id);
        await repo.setPositions(tx, rules.withPositions(next));

        await repo.recordDecision(tx, swapId, {
            status: "Effected",
            decidedBy: actor.userId,
            reason: null,
            requesterAfter: next.indexOf(a.member_id) + 1,
            counterpartyAfter: next.indexOf(b.member_id) + 1
        });
        return { swap, a, b, next };
    });

    if (outcome.notFound) throw new NotFound("That exchange was not found in this club.");
    if (outcome.refused) {
        await refuse(audit, "queue.swapApprove", outcome.refused, { requirement: "REQ-75" }, { type: "queue_swap", id: swapId });
    }

    await audit("queue.swapApprove", "Success", {
        detail:
            `${actor.fullName} approved the exchange. ${outcome.a.full_name} moved from ${outcome.a.queue_position} ` +
            `to ${outcome.next.indexOf(outcome.a.member_id) + 1} and ${outcome.b.full_name} from ` +
            `${outcome.b.queue_position} to ${outcome.next.indexOf(outcome.b.member_id) + 1}. ` +
            `${outcome.swap.counterparty_name} consented.`,
        targetType: "queue_swap",
        targetId: swapId
    });
    return presentSwap(await repo.getSwap(db, swapId));
}

async function rejectSwap(db, swapId, { reason }, { actor, audit }) {
    if (!reason || !String(reason).trim()) {
        throw new BadRequest("Record why the exchange is being refused.");
    }
    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        await repo.lockClub(tx);
        const swap = await repo.getSwap(tx, swapId, { forUpdate: true });
        if (!swap) return { notFound: true };
        if (!["Pending consent", "Pending approval"].includes(swap.status)) {
            return { refused: `This exchange is ${swap.status.toLowerCase()} and cannot be refused.`, swap };
        }
        await repo.recordDecision(tx, swapId, { status: "Rejected", decidedBy: actor.userId, reason: String(reason).trim() });
        return { swap };
    });

    if (outcome.notFound) throw new NotFound("That exchange was not found in this club.");
    if (outcome.refused) {
        await refuse(audit, "queue.swapReject", outcome.refused, { requirement: "REQ-75" }, { type: "queue_swap", id: swapId });
    }
    await audit("queue.swapReject", "Success", {
        detail: `${actor.fullName} refused the exchange between ${outcome.swap.requester_name} and ${outcome.swap.counterparty_name}: ${String(reason).trim()}`,
        targetType: "queue_swap",
        targetId: swapId
    });
    return presentSwap(await repo.getSwap(db, swapId));
}

async function cancelSwap(db, swapId, { actor, audit }) {
    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        await repo.lockClub(tx);
        const swap = await repo.getSwap(tx, swapId, { forUpdate: true });
        if (!swap) return { notFound: true };
        if (swap.requester_member_id !== actor.memberId) {
            return { refused: `Only ${swap.requester_name} can withdraw this request.`, swap };
        }
        if (!["Pending consent", "Pending approval"].includes(swap.status)) {
            return { refused: `This exchange is ${swap.status.toLowerCase()} and cannot be withdrawn.`, swap };
        }
        await repo.cancelSwap(tx, swapId, { cancelledBy: actor.userId });
        return { swap };
    });

    if (outcome.notFound) throw new NotFound("That exchange was not found in this club.");
    if (outcome.refused) {
        await refuse(audit, "queue.swapCancel", outcome.refused, {}, { type: "queue_swap", id: swapId });
    }
    await audit("queue.swapCancel", "Success", {
        detail: `${actor.fullName} withdrew the request to exchange with ${outcome.swap.counterparty_name}.`,
        targetType: "queue_swap",
        targetId: swapId
    });
    return presentSwap(await repo.getSwap(db, swapId));
}

// ---------------------------------------------------------------------------
// REQ-77: a member at the head who is not in good standing
// ---------------------------------------------------------------------------

/**
 * The queue will not advance past a member in arrears. The Chairperson chooses:
 *
 *   defer   the member goes to the end of the queue and the next member is at
 *           the head
 *   pay     the member is paid notwithstanding the arrears. Nothing moves. The
 *           ruling is recorded and allows ONE payout to that member.
 *
 * Either way the choice and the reason are recorded (BR-5). A suspended member
 * can only be deferred: REQ-67 forbids paying them at all.
 */
async function resolveArrears(db, { memberId, decision, reason }, { actor, audit }) {
    const wanted = { defer: "Deferred", pay: "Paid notwithstanding arrears" }[decision];
    if (!wanted) throw new BadRequest('Choose "defer" or "pay".');
    if (!reason || !String(reason).trim()) throw new BadRequest("Record the reason for this decision.");

    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        const club = await repo.lockClub(tx);
        requireRotating(club);

        const rows = await repo.listQueueRows(tx);
        const order = rowsToOrder(rows);
        const member = rows.find((r) => r.member_id === memberId);
        if (!member) return { notFound: true };

        if (order[0] !== memberId) {
            return { refused: `${member.full_name} is not at the head of the queue. A ruling is only needed for the member who is next to be paid.` };
        }
        if (member.standing === "Good standing") {
            return { refused: `${member.full_name} is in good standing, so there is nothing to rule on.` };
        }
        if (!["In arrears", "Suspended"].includes(member.standing)) {
            return { refused: `${member.full_name} is ${member.standing.toLowerCase()} and cannot be paid from the pool.` };
        }
        if (decision === "pay" && member.standing !== "In arrears") {
            return { refused: `${member.full_name} is ${member.standing.toLowerCase()}. A suspended member cannot be paid from the pool (REQ-67). They can only be deferred.` };
        }
        if (await repo.hasOpenRotationPayout(tx)) {
            return { refused: "A payout is waiting for approval. Approve or cancel it before ruling on the queue." };
        }

        const recorded = await repo.insertArrearsDecision(tx, {
            memberId,
            decision: wanted,
            standingAtDecision: member.standing,
            reason: String(reason).trim(),
            decidedBy: actor.userId
        });

        if (decision === "defer") {
            await repo.setPositions(tx, rules.withPositions(rules.moveToEnd(order, memberId)));
        }
        return { member, recorded, newHead: decision === "defer" ? rows.find((r) => r.member_id === order[1]) : null };
    });

    if (outcome.notFound) throw new NotFound("That member is not in this club's queue.");
    if (outcome.refused) {
        await refuse(audit, "queue.resolveArrears", outcome.refused, { requirement: "REQ-77, BR-5" });
    }

    await audit("queue.resolveArrears", "Success", {
        detail:
            `${actor.fullName} ruled on ${outcome.member.full_name} (${outcome.member.standing}) at the head of the queue: ` +
            `${wanted}. Reason: ${String(reason).trim()}` +
            (outcome.newHead ? ` ${outcome.newHead.full_name} is now at the head.` : ""),
        targetType: "queue_arrears_decision",
        targetId: outcome.recorded.decision_id
    });
    return {
        decisionId: outcome.recorded.decision_id,
        decision: wanted,
        member: { memberId, fullName: outcome.member.full_name },
        newHead: outcome.newHead ? { memberId: outcome.newHead.member_id, fullName: outcome.newHead.full_name } : null
    };
}

module.exports = {
    getQueue,
    getOwnPosition,
    establishQueue,
    requestSwap,
    consentToSwap,
    approveSwap,
    rejectSwap,
    cancelSwap,
    resolveArrears,
    advanceAfterPayout,
    removeFromQueue,
    // For the payout module.
    rowsToOrder,
    nextPayout
};