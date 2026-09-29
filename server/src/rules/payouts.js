"use strict";

/**
 * Payout eligibility. REQ-65 to REQ-68, REQ-72, REQ-77. SDD: assessEligibility().
 *
 * Decides whether a rotating payout may be initiated or posted, from facts the
 * service has already gathered. It returns every reason for refusing, not just
 * the first, because a Treasurer who fixes one problem and is then told about
 * the next has been misled about how far from done they were.
 *
 * The same function runs twice: when the Treasurer initiates, and again when
 * the Chairperson approves. Between the two, a swap can be approved, the pool
 * can fall, a member's standing can change. Approval is the moment money
 * moves, so it is assessed against the facts at that moment.
 *
 * Amounts arrive and leave as integer cents (lib/money.js).
 *
 * Pure functions. No database, no Express.
 */

const { toNumeric } = require("../lib/money");
const { compareIso } = require("../lib/dates");

// Plain text so that a refusal reads the same on every screen and in the audit log.
const rands = (cents) => `R${toNumeric(cents)}`;

/**
 * @param {object} f the facts
 * @param {string} f.clubType
 * @param {{memberId:string, fullName:string, standing:string, position:number|null}|null} f.recipient
 * @param {{memberId:string, fullName:string}|null} f.head the member at the head of the queue
 * @param {number} f.amountCents
 * @param {number} f.poolCents
 * @param {{dueDate:string, sequenceNumber:number}|null} f.cycle
 * @param {string} f.today YYYY-MM-DD
 * @param {{decisionId:string}|null} f.arrearsRuling a usable ruling to pay this member notwithstanding arrears
 * @returns {{eligible:boolean, refusals:Array, chairpersonOptions:string[]|null, notes:string[]}}
 */
function assessRotationPayout(f) {
    const refusals = [];
    const notes = [];
    let chairpersonOptions = null;

    const refuse = (requirement, code, message) => refusals.push({ requirement, code, message });

    if (f.clubType !== "Rotating") {
        refuse("REQ-71", "NOT_ROTATING", "Only a Rotating club pays members in turn.");
    }

    if (!f.head) {
        refuse("REQ-71", "EMPTY_QUEUE", "This club has nobody in its payout queue.");
    }

    if (!f.cycle) {
        refuse("REQ-72", "NO_CYCLE_TO_PAY",
            "There is no cycle waiting to be paid out. A cycle can be paid out once its due date has passed.");
    } else if (compareIso(f.cycle.dueDate, f.today) >= 0) {
        refuse("REQ-72", "CYCLE_STILL_COLLECTING",
            `Cycle ${f.cycle.sequenceNumber} is still collecting. It falls due on ${f.cycle.dueDate}, ` +
            "and it can be paid out after that date.");
    }

    // REQ-72: only the member at the head.
    if (f.head && f.recipient && f.recipient.memberId !== f.head.memberId) {
        refuse("REQ-72", "NOT_AT_HEAD",
            `${f.recipient.fullName} is at position ${f.recipient.position ?? "none"} in the queue. ` +
            `Only the member at the head, ${f.head.fullName}, can be paid now.`);
    }

    // REQ-67 and REQ-77: standing.
    if (f.recipient) {
        const s = f.recipient.standing;
        if (s === "Suspended") {
            refuse("REQ-67", "SUSPENDED",
                `${f.recipient.fullName} is suspended and cannot be paid from the pool.`);
            chairpersonOptions = ["defer"];
        } else if (s === "Expelled" || s === "Exited") {
            refuse("REQ-67", "NOT_A_MEMBER",
                `${f.recipient.fullName} is ${s.toLowerCase()} and cannot be paid from the pool.`);
        } else if (s === "In arrears") {
            if (f.arrearsRuling) {
                notes.push(
                    `${f.recipient.fullName} is in arrears. The Chairperson ruled that they are to be paid ` +
                    "notwithstanding the arrears (REQ-77).");
            } else {
                refuse("REQ-77", "IN_ARREARS",
                    `${f.recipient.fullName} is in arrears. The queue cannot advance past them until the ` +
                    "Chairperson either defers them to the end of the queue or resolves to pay them notwithstanding the arrears.");
                chairpersonOptions = ["defer", "pay"];
            }
        }
    }

    // REQ-66.
    if (!Number.isInteger(f.amountCents) || f.amountCents <= 0) {
        refuse("REQ-66", "NOTHING_TO_PAY",
            "No contributions have been captured for this cycle, so there is nothing to pay out.");
    } else if (f.amountCents > f.poolCents) {
        refuse("REQ-66", "EXCEEDS_POOL",
            `The payout of ${rands(f.amountCents)} is more than the pool balance of ${rands(f.poolCents)}. ` +
            `The pool is ${rands(f.amountCents - f.poolCents)} short.`);
    }

    return { eligible: refusals.length === 0, refusals, chairpersonOptions, notes };
}

/**
 * The rule as it is recorded on the payout (REQ-68) and shown to the approver
 * (REQ-65). Written out in full so that the record still reads correctly after
 * the constitution has been amended.
 */
function describeRotationRule({ constitutionVersion, payoutOrderMethod, cycleSequence }) {
    return (
        `Rotating club, constitution version ${constitutionVersion}. ` +
        `Payout order method: ${payoutOrderMethod || "not stated"}. ` +
        `The member at the head of the queue receives the contributions captured for cycle ${cycleSequence}, ` +
        "provided they are in good standing and the pool balance covers the amount."
    );
}

module.exports = { assessRotationPayout, describeRotationRule, rands };