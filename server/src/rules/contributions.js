"use strict";

/**
 * Contribution status rules. REQ-54, REQ-55.
 *
 * Pure functions. No database, no Express, no dates read from the system clock
 * unless one is passed in. Every branch below can be exercised in a test
 * without starting anything, which is what SRS 5.4 asks for under Testability.
 */

const { toCents } = require("../lib/money");

const STATUSES = ["Paid", "Partial", "Outstanding", "Late"];

/**
 * resolveStatus() — SRS 4.4.6.
 *
 * REQ-54 makes the four statuses mutually exclusive, and REQ-55 defines the
 * boundary: Outstanding until the due date, Late once the due date AND the
 * grace period have both elapsed without full payment.
 *
 * That leaves one case the requirement does not name — a member who has paid
 * SOMETHING but not everything, after the grace period has run out. The
 * decision here is that Late wins. A club chasing arrears needs one list of
 * who is overdue, and a part-payment that is still short is still overdue. The
 * amount paid is not lost: it stays on captured_amount and appears on the
 * member's statement.
 *
 * @param {object}  args
 * @param {string|number} args.expected     expected amount (NUMERIC string)
 * @param {string|number} args.captured     captured so far
 * @param {string|Date}   args.dueDate      the cycle's due date
 * @param {number}        args.graceDays    from the constitution in force
 * @param {Date}          [args.asAt]       defaults to now
 * @returns {"Paid"|"Partial"|"Outstanding"|"Late"}
 */
function resolveStatus({ expected, captured, dueDate, graceDays = 0, asAt = new Date() }) {
    const expectedCents = toCents(expected);
    const capturedCents = toCents(captured);

    // Paid first: a member who has settled in full is never Late, however long
    // they took to do it. The status describes where they stand now, not their
    // punctuality — the penalty record carries that.
    if (capturedCents >= expectedCents) return "Paid";

    const deadline = new Date(dueDate);
    deadline.setDate(deadline.getDate() + Number(graceDays || 0));
    // Grace runs to the END of its last day.
    deadline.setHours(23, 59, 59, 999);

    if (asAt > deadline) return "Late";

    return capturedCents > 0 ? "Partial" : "Outstanding";
}

/**
 * The date on which an unpaid contribution becomes Late, for display. A member
 * should be able to see the deadline rather than discover it.
 */
function lateFrom(dueDate, graceDays = 0) {
    const d = new Date(dueDate);
    d.setDate(d.getDate() + Number(graceDays || 0) + 1);
    return d;
}

/** REQ-56: a penalty is due when the status has resolved to Late. */
function penaltyIsDue(status) {
    return status === "Late";
}

/**
 * REQ-60: refuse a capture of zero or less.
 *
 * Returns null when acceptable, or the sentence to show the treasurer.
 */
function checkCaptureAmount(amount) {
    let cents;
    try {
        cents = toCents(amount);
    } catch {
        return "Enter the amount received, for example 500 or 500.00.";
    }
    if (cents <= 0) return "A contribution must be more than zero.";
    // A guard against a slipped decimal point: R500 000 into a club whose
    // contribution is R500 is far more likely to be a typing error than a gift.
    if (cents > 100_000_000) return "That amount looks wrong. Check it before capturing.";
    return null;
}

/** REQ-52: an electronic transfer must carry its reference. */
function checkMethod(method, reference) {
    const METHODS = ["Cash", "Electronic funds transfer", "Other"];
    if (!METHODS.includes(method)) {
        return { method: `Choose a payment method: ${METHODS.join(", ")}.` };
    }
    if (method === "Electronic funds transfer" && !String(reference || "").trim()) {
        return { reference: "An electronic transfer must carry its transaction reference." };
    }
    return null;
}

module.exports = { STATUSES, resolveStatus, lateFrom, penaltyIsDue, checkCaptureAmount, checkMethod };