"use strict";

/**
 * Constitution rules. REQ-22 to REQ-29.
 *
 * validateConsistency() — SRS 4.4.2, REQ-29.
 *
 * A constitution is configuration, not code: it is the mechanism by which one
 * system runs clubs whose rules differ. That only works if the parameter set is
 * coherent, so it is checked before it is ever activated. An incoherent
 * constitution does not fail loudly at capture time — it fails quietly months
 * later, when a penalty is levied on a date that cannot arrive.
 *
 * Pure functions. No database.
 */

const { toCents } = require("../lib/money");

const CLUB_TYPES = ["Rotating", "Accumulating", "Burial"];
const FREQUENCIES = ["Weekly", "Fortnightly", "Monthly"];
const PAYOUT_ORDER_METHODS = ["Random draw", "Seniority", "Negotiated"];

/** REQ-29 compares the grace period against the cycle length, so it needs one. */
const CYCLE_DAYS = { Weekly: 7, Fortnightly: 14, Monthly: 28 };

/**
 * Monthly is taken as 28 days, not 30 or 31.
 *
 * The comparison exists to stop a grace period swallowing a whole cycle, and
 * February is the month where that is easiest to do by accident. Using the
 * shortest possible month means a constitution that passes here is coherent in
 * every month of the year rather than in eleven of them.
 */
function cycleLengthDays(frequency) {
    return CYCLE_DAYS[frequency] ?? 28;
}

/**
 * @returns {{valid: boolean, errors: object}} errors keyed by field name
 */
function validateConsistency(c) {
    const errors = {};

    if (!c.clubType || !CLUB_TYPES.includes(c.clubType)) {
        errors.clubType = `Choose a club type: ${CLUB_TYPES.join(", ")}.`;
    }

    // REQ-23.
    if (!c.cycleFrequency || !FREQUENCIES.includes(c.cycleFrequency)) {
        errors.cycleFrequency = `Choose how often members contribute: ${FREQUENCIES.join(", ")}.`;
    }

    // REQ-29: the contribution must be greater than zero.
    let contributionCents = 0;
    try {
        contributionCents = toCents(c.contributionAmount);
    } catch {
        contributionCents = 0;
    }
    if (contributionCents <= 0) {
        errors.contributionAmount = "The contribution must be more than zero.";
    }

    // REQ-24.
    let penaltyCents = 0;
    try {
        penaltyCents = toCents(c.penaltyAmount || 0);
    } catch {
        penaltyCents = -1;
    }
    if (penaltyCents < 0) {
        errors.penaltyAmount = "The penalty cannot be negative. Enter 0 if the club levies none.";
    }
    if (penaltyCents > contributionCents * 5 && contributionCents > 0) {
        errors.penaltyAmount =
            "That penalty is more than five times the contribution. Check it before continuing.";
    }

    // REQ-29: the grace period may not exceed the cycle length.
    const grace = Number(c.gracePeriodDays ?? 0);
    if (!Number.isInteger(grace) || grace < 0) {
        errors.gracePeriodDays = "The grace period must be a whole number of days, or zero.";
    } else if (c.cycleFrequency && grace >= cycleLengthDays(c.cycleFrequency)) {
        errors.gracePeriodDays =
            `A grace period of ${grace} days is as long as a ${c.cycleFrequency.toLowerCase()} ` +
            `cycle (${cycleLengthDays(c.cycleFrequency)} days). A contribution would never ` +
            `become late.`;
    }

    // REQ-29: quorum between 1 and 100 per cent.
    const quorum = Number(c.quorumPercentage ?? 0);
    if (!Number.isInteger(quorum) || quorum < 1 || quorum > 100) {
        errors.quorumPercentage = "The quorum must be a whole percentage between 1 and 100.";
    }

    // REQ-26.
    const notice = Number(c.exitNoticeDays ?? 0);
    if (!Number.isInteger(notice) || notice < 0) {
        errors.exitNoticeDays = "The exit notice period must be a whole number of days, or zero.";
    }

    // REQ-28: a rotating club needs a method for setting the initial order.
    if (c.clubType === "Rotating") {
        if (!c.payoutOrderMethod || !PAYOUT_ORDER_METHODS.includes(c.payoutOrderMethod)) {
            errors.payoutOrderMethod =
                `A rotating club needs a way to set the payout order: ${PAYOUT_ORDER_METHODS.join(", ")}.`;
        }
    }

    // REQ-27: a burial society needs its benefit schedule.
    if (c.clubType === "Burial") {
        const schedule = Array.isArray(c.benefitSchedule) ? c.benefitSchedule : [];
        if (schedule.length === 0) {
            errors.benefitSchedule =
                "A burial society needs at least one covered category and the amount payable for it.";
        } else {
            const bad = schedule.some((row) => {
                if (!row?.category || !String(row.category).trim()) return true;
                try {
                    return toCents(row.amount) <= 0;
                } catch {
                    return true;
                }
            });
            if (bad) {
                errors.benefitSchedule =
                    "Every covered category needs a name and a benefit amount greater than zero.";
            }
        }

        const waiting = Number(c.waitingPeriodDays ?? 0);
        if (!Number.isInteger(waiting) || waiting < 0) {
            errors.waitingPeriodDays = "The waiting period must be a whole number of days, or zero.";
        }
    }

    // REQ-79: an accumulating club distributes on a recurring calendar date
    // named in the constitution. A day is stored as-is and clamped to the last
    // valid day of whichever month it falls in for a given year (lib/dates.js
    // -> yearEndDateFor), the same way 31 January amended into a monthly cycle
    // lands on 28 or 29 February rather than being rejected outright.
    if (c.clubType === "Accumulating") {
        const month = Number(c.yearEndMonth);
        const day = Number(c.yearEndDay);
        if (!Number.isInteger(month) || month < 1 || month > 12) {
            errors.yearEndMonth = "Give the month the club's year ends in, 1 to 12.";
        }
        if (!Number.isInteger(day) || day < 1 || day > 31) {
            errors.yearEndDay = "Give the day of the month the club's year ends on, 1 to 31.";
        }
    }

    return { valid: Object.keys(errors).length === 0, errors };
}

module.exports = {
    CLUB_TYPES,
    FREQUENCIES,
    PAYOUT_ORDER_METHODS,
    cycleLengthDays,
    validateConsistency
};