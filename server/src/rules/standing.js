"use strict";

/**
 * Standing rules. REQ-44, REQ-101 to REQ-103.
 *
 * evaluateStanding() decides where a member's standing should move next:
 * Good -> Warning -> Suspended -> Expelled, advancing on constitution
 * thresholds, and back to Good once arrears and penalties are cleared.
 *
 * Expulsion never happens automatically: it waits for a resolution (T5).
 * One step per run, so every stage is recorded rather than skipped.
 *
 * Pure functions. No database.
 */

const STANDING = Object.freeze({
    GOOD: "good",
    WARNING: "warning",
    SUSPENDED: "suspended",
    EXPELLED: "expelled"
});

const ORDER = [STANDING.GOOD, STANDING.WARNING, STANDING.SUSPENDED, STANDING.EXPELLED];

/**
 * @param {{standing: string, missedContributions: number, arrearsCents: number,
 *          penaltiesOutstandingCents: number, expulsionApproved?: boolean}} member
 * @param {{warningAfterMissed: number, suspensionAfterMissed: number,
 *          expulsionAfterMissed: number}} thresholds
 * @param {Date} now
 */
function evaluateStanding(member, thresholds, now = new Date()) {
    const {
        standing,
        missedContributions,
        arrearsCents,
        penaltiesOutstandingCents,
        expulsionApproved = false
    } = member;

    const unchanged = (reason, needsResolution = false) => ({
        standing,
        changed: false,
        action: null,
        reason,
        needsResolution,
        changedAt: null
    });

    // Expulsion is only ever reversed by a resolution, never automatically.
    if (standing === STANDING.EXPELLED) return unchanged("expelled_by_resolution_only");

    // Arrears and penalties cleared: back to Good standing, with the date.
    if (arrearsCents <= 0 && penaltiesOutstandingCents <= 0) {
        if (standing === STANDING.GOOD) return unchanged("already_good");
        return {
            standing: STANDING.GOOD,
            changed: true,
            action: "restore_good_standing",
            reason: "arrears_and_penalties_cleared",
            needsResolution: false,
            changedAt: now
        };
    }

    // Which stage do the thresholds call for?
    let target = STANDING.GOOD;
    if (missedContributions >= thresholds.expulsionAfterMissed) target = STANDING.EXPELLED;
    else if (missedContributions >= thresholds.suspensionAfterMissed) target = STANDING.SUSPENDED;
    else if (missedContributions >= thresholds.warningAfterMissed) target = STANDING.WARNING;

    const current = ORDER.indexOf(standing);
    if (ORDER.indexOf(target) <= current) return unchanged("no_advance");

    const next = ORDER[current + 1];

    // Expulsion must wait for a resolution (T5).
    if (next === STANDING.EXPELLED && !expulsionApproved) {
        return unchanged("awaiting_resolution", true);
    }

    return {
        standing: next,
        changed: true,
        action: `advance_to_${next}`,
        reason: "threshold_reached",
        needsResolution: false,
        changedAt: now
    };
}

module.exports = { STANDING, evaluateStanding };