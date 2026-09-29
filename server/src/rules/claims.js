"use strict";

/**
 * Burial claim rules. REQ-83 to REQ-88. SDD: assessBurialClaim(), isCoveredDependant().
 *
 *     resolveBenefitAmount()   REQ-86: the amount, from the category and the schedule
 *     assessLodgement()        REQ-84, REQ-85, REQ-87: may this claim be lodged at all
 *     assessClaimPayment()     REQ-64, REQ-67, REQ-88: may it be paid now
 *
 * A claim's eligibility to be LODGED (REQ-84, REQ-85, REQ-87) is a different
 * question from its eligibility to be PAID (REQ-88, and the general REQ-67
 * every payout is subject to). The first is checked once, at lodgement,
 * against facts that do not change afterwards (whether the dependant was
 * covered before the death, whether the waiting period had elapsed on the day
 * the claim was lodged). The second is checked when the Treasurer wants to
 * pay it, against the pool and the claim's place in the queue, and again at
 * approval the way every other payout is.
 *
 * Pure functions. No database, no Express.
 */

const { assertIsoDate, compareIso, addDays } = require("../lib/dates");
const { toCents } = require("../lib/money");

// ---------------------------------------------------------------------------
// resolveBenefitAmount()  REQ-86
// ---------------------------------------------------------------------------

/**
 * @param {Array<{category:string, amount:*}>} benefitSchedule
 * @param {string} category
 * @returns {{ok:boolean, amountCents?:number, reason?:string}}
 */
function resolveBenefitAmount(benefitSchedule, category) {
    const row = (benefitSchedule || []).find(
        (r) => String(r.category).trim().toLowerCase() === String(category).trim().toLowerCase()
    );
    if (!row) {
        return { ok: false, reason: `The constitution's benefit schedule has no amount for the category "${category}".` };
    }
    return { ok: true, amountCents: toCents(row.amount) };
}

// ---------------------------------------------------------------------------
// assessLodgement()  REQ-84, REQ-85, REQ-87, BR-11
// ---------------------------------------------------------------------------

/**
 * @param {object} f
 * @param {string} f.clubType
 * @param {string} f.claimantStanding      REQ-84
 * @param {object|null} f.dependant        {memberId, category, registeredAt, removedAt} or null if none found  REQ-85
 * @param {string} f.claimantMemberId
 * @param {string} f.dateOfDeath           YYYY-MM-DD
 * @param {string} f.today                 YYYY-MM-DD, the date the claim is being lodged
 * @param {number} f.memberJoinDate        YYYY-MM-DD, the claimant's own admission date
 * @param {number} f.waitingPeriodDays
 * @param {boolean} f.alreadyClaimed       a live claim already exists for this dependant
 * @returns {{eligible:boolean, refusals:Array}}
 */
function assessLodgement(f) {
    const refusals = [];
    const refuse = (requirement, code, message) => refusals.push({ requirement, code, message });

    if (f.clubType !== "Burial") {
        refuse("REQ-83", "NOT_BURIAL", "Only a burial society pays a claim on a covered dependant's death.");
    }

    // Validated first: every check below compares against this date, and a
    // malformed one must stop them raising instead of being refused cleanly.
    const dateOk = assertIsoDateSafe(f.dateOfDeath);
    if (!dateOk) {
        refuse("REQ-83", "BAD_DATE", "Give the date of death as a calendar date, YYYY-MM-DD.");
    } else if (compareIso(f.dateOfDeath, f.today) > 0) {
        refuse("REQ-83", "FUTURE_DATE", "The date of death cannot be in the future.");
    }

    // REQ-84.
    if (f.claimantStanding !== "Good standing") {
        refuse(
            "REQ-84", "CLAIMANT_NOT_ELIGIBLE",
            `Your standing is ${f.claimantStanding}. A claim may only be lodged while the claimant is in good standing.`
        );
    }

    // REQ-85, BR-11: covered BEFORE the death, and still covered at the time of death.
    if (!f.dependant) {
        refuse("REQ-85", "NOT_A_DEPENDANT", "That person is not recorded as a covered dependant.");
    } else {
        if (f.dependant.memberId !== f.claimantMemberId) {
            refuse("REQ-85", "NOT_YOUR_DEPENDANT", "That person is recorded as a covered dependant of a different member, not yours.");
        }
        if (dateOk && compareIso(f.dependant.registeredAt, f.dateOfDeath) > 0) {
            refuse("REQ-85", "NOT_COVERED_BEFORE_DEATH", "This dependant was recorded after the date of death. Cover must have been in place before the death occurred (BR-11).");
        }
        if (dateOk && f.dependant.removedAt && compareIso(f.dependant.removedAt, f.dateOfDeath) <= 0) {
            refuse("REQ-85", "COVER_ALREADY_ENDED", `Cover for this dependant ended on ${f.dependant.removedAt}, before the date of death.`);
        }
        if (f.alreadyClaimed) {
            refuse("REQ-85", "ALREADY_CLAIMED", "A claim has already been lodged in respect of this dependant.");
        }
    }

    // REQ-87: the first date a claim may be lodged, measured against today (the
    // lodgement date), not the date of death — the requirement's own wording is
    // a period on LODGING, not on when a covered death is recognised.
    if (f.memberJoinDate && f.waitingPeriodDays > 0) {
        const firstEligibleDate = addDays(f.memberJoinDate, f.waitingPeriodDays);
        if (compareIso(f.today, firstEligibleDate) < 0) {
            refuse(
                "REQ-87", "WAITING_PERIOD",
                `The waiting period has not yet elapsed. The first date a claim may be lodged in respect of your ` +
                `dependants is ${firstEligibleDate}.`
            );
        }
    }

    return { eligible: refusals.length === 0, refusals };
}

function assertIsoDateSafe(value) {
    try { assertIsoDate(value); return true; } catch { return false; }
}

// ---------------------------------------------------------------------------
// assessClaimPayment()  REQ-64, REQ-67, REQ-88, BR-12
// ---------------------------------------------------------------------------

/**
 * @param {object} f
 * @param {string} f.claimantStanding
 * @param {number} f.benefitCents
 * @param {number} f.poolCents
 * @param {boolean} f.isOldestUnresolved     REQ-88: no earlier-lodged claim is still waiting
 * @param {string|null} f.oldestLodgedAt     when the true oldest unresolved claim was lodged, for the message
 * @returns {{eligible:boolean, refusals:Array}}
 */
function assessClaimPayment(f) {
    const refusals = [];
    const refuse = (requirement, code, message) => refusals.push({ requirement, code, message });

    // REQ-67, BR-5, general to every payout.
    if (["Suspended", "Expelled"].includes(f.claimantStanding)) {
        refuse("REQ-67", "CLAIMANT_NOT_ELIGIBLE", `The claimant is ${f.claimantStanding.toLowerCase()} and may not receive money from the pool.`);
    }

    // REQ-88: strict lodged-order. A later claim may not jump ahead of an
    // earlier one that is still unresolved, whatever the reason.
    if (!f.isOldestUnresolved) {
        refuse(
            "REQ-88", "OUT_OF_ORDER",
            `An earlier claim, lodged ${f.oldestLodgedAt}, has not yet been resolved. Claims are paid in the order ` +
            "they were lodged."
        );
    }

    // REQ-88, BR-12: no part-payment. A shortfall is a refusal, not a smaller
    // payout.
    if (f.benefitCents > f.poolCents) {
        refuse(
            "REQ-88", "INSUFFICIENT_POOL",
            `The benefit of ${f.benefitCents} cents exceeds the pool balance of ${f.poolCents} cents. The shortfall ` +
            "is presented for the Chairperson's attention; no part-payment is made (BR-12)."
        );
    }

    return { eligible: refusals.length === 0, refusals };
}

module.exports = { resolveBenefitAmount, assessLodgement, assessClaimPayment };