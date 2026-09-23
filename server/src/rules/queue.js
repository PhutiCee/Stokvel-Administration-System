"use strict";

/**
 * Payout queue rules. REQ-71 to REQ-78.
 *
 * A queue is an ordered array of member ids. The member at index 0 is at the
 * head and position is index + 1. Every function returns a NEW array and never
 * changes its argument, and none of them knows about the database.
 *
 * The invariant that matters, from REQ-73 and REQ-76: whatever happens to one
 * member, every other member keeps the same order relative to each other. Only
 * the members named in the operation move relative to the rest.
 *
 * Pure functions. No database, no Express.
 */

const { assertIsoDate, addCycles } = require("../lib/dates");

function indexOrThrow(order, memberId) {
    const i = order.indexOf(memberId);
    if (i === -1) throw new Error(`Member ${memberId} is not in the queue.`);
    return i;
}

/** The member ids of rows that hold a position, in position order. */
function orderOf(rows) {
    return rows
        .filter((r) => r.position !== null && r.position !== undefined)
        .slice()
        .sort((a, b) => a.position - b.position)
        .map((r) => r.memberId);
}

/** [{memberId, position}] with positions 1..n and no gaps. */
function withPositions(order) {
    return order.map((memberId, i) => ({ memberId, position: i + 1 }));
}

function head(order) {
    return order.length ? order[0] : null;
}

/**
 * REQ-73: a member who has been paid goes to the end.
 * REQ-77: so does a member the Chairperson defers.
 * Everyone behind them moves up one place, in the order they were already in.
 */
function moveToEnd(order, memberId) {
    indexOrThrow(order, memberId);
    return [...order.filter((id) => id !== memberId), memberId];
}

/**
 * REQ-76: a member who exits or is expelled leaves the queue. The gap closes
 * and nobody else changes order.
 */
function removeMember(order, memberId) {
    indexOrThrow(order, memberId);
    return order.filter((id) => id !== memberId);
}

/** REQ-42, REQ-76: a member who joins goes to the end. */
function appendMember(order, memberId) {
    if (order.includes(memberId)) throw new Error(`Member ${memberId} is already in the queue.`);
    return [...order, memberId];
}

/**
 * REQ-75: the two members exchange places. Every other member stays exactly
 * where they are.
 */
function swap(order, memberA, memberB) {
    if (memberA === memberB) throw new Error("A member cannot exchange places with themselves.");
    const i = indexOrThrow(order, memberA);
    const j = indexOrThrow(order, memberB);
    const next = order.slice();
    next[i] = memberB;
    next[j] = memberA;
    return next;
}

/**
 * REQ-71, "Random draw". The randomness is passed in, so that a test can supply
 * a fixed sequence and the service can supply crypto.randomInt. Fisher-Yates:
 * every ordering is equally likely.
 *
 * @param {string[]} memberIds
 * @param {(maxExclusive:number)=>number} randomInt integer in [0, maxExclusive)
 */
function drawOrder(memberIds, randomInt) {
    const a = memberIds.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = randomInt(i + 1);
        [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
}

/**
 * REQ-71, "Seniority". Earliest join date first. Members who joined on the same
 * day are ordered by when they were registered, then by id, so that the answer
 * is the same every time it is asked.
 *
 * @param {Array<{memberId:string, joinDate:string, registeredAt:string}>} members
 */
function seniorityOrder(members) {
    for (const m of members) assertIsoDate(m.joinDate, `Join date of ${m.memberId}`);
    return members
        .slice()
        .sort((a, b) =>
            a.joinDate < b.joinDate ? -1 : a.joinDate > b.joinDate ? 1 :
            String(a.registeredAt) < String(b.registeredAt) ? -1 :
            String(a.registeredAt) > String(b.registeredAt) ? 1 :
            a.memberId < b.memberId ? -1 : a.memberId > b.memberId ? 1 : 0
        )
        .map((m) => m.memberId);
}

/**
 * REQ-71, "Negotiated". The order the members agreed, supplied by the
 * Chairperson. It must name every member of the queue exactly once.
 *
 * @returns {{valid:boolean, error?:string}}
 */
function checkProposedOrder(current, proposed) {
    if (!Array.isArray(proposed)) return { valid: false, error: "Give the agreed order as a list of members." };
    if (new Set(proposed).size !== proposed.length) {
        return { valid: false, error: "A member appears more than once in that order." };
    }
    const missing = current.filter((id) => !proposed.includes(id));
    const unknown = proposed.filter((id) => !current.includes(id));
    if (unknown.length) return { valid: false, error: "The order names someone who is not in this club's queue." };
    if (missing.length) return { valid: false, error: `The order leaves out ${missing.length} member(s) of the queue.` };
    return { valid: true };
}

/**
 * REQ-78: the date on which each member reaches the head of the queue.
 *
 * The queue advances one place per cycle, so the member at position p reaches
 * the head p - 1 cycles after the next payout is due. This is a projection
 * from the queue as it stands. It does not know about a swap not yet approved
 * or a member who will be deferred for arrears.
 *
 * @param {string[]} order
 * @param {string|null} nextPayoutDate YYYY-MM-DD, the date the member at the head is due to be paid
 * @param {string} frequency Weekly, Fortnightly or Monthly
 * @returns {Map<string, string|null>} member id to date, or null when no date can be given
 */
function projectHeadDates(order, nextPayoutDate, frequency) {
    const dates = new Map();
    order.forEach((memberId, i) => {
        dates.set(memberId, nextPayoutDate ? addCycles(nextPayoutDate, i, frequency) : null);
    });
    return dates;
}

module.exports = {
    orderOf, withPositions, head, moveToEnd, removeMember, appendMember, swap,
    drawOrder, seniorityOrder, checkProposedOrder, projectHeadDates
};