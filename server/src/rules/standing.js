"use strict";

/**
 * Standing rules. REQ-44, REQ-101 to REQ-103.
 *
 * Moves a member Good standing -> In arrears (the warning stage) -> Suspended
 * -> Expelled on constitution thresholds, and back to Good standing once
 * arrears and penalties are cleared. One step per run, so every stage is
 * recorded. Expulsion never happens on its own: it waits for a resolution (T5).
 *
 * The values are the labels of the member_standing enum (migration 004).
 * Pure functions. No database.
 */

const STANDING = Object.freeze({
    GOOD: "Good standing",
    WARNING: "In arrears",
    SUSPENDED: "Suspended",
    EXPELLED: "Expelled",
    EXITED: "Exited"
});

const ORDER = [STANDING.GOOD, STANDING.WARNING, STANDING.SUSPENDED, STANDING.EXPELLED];

const STEP_ACTION = Object.freeze({
    [STANDING.WARNING]: "issue_warning",
    [STANDING.SUSPENDED]: "suspend",
    [STANDING.EXPELLED]: "expel"
});

/**
 * @param {{standing: string, missedContributions: number, arrearsCents: number,
 *          penaltiesOutstandingCents: number, expulsionApproved?: boolean}} member
 * @param {{warningAfterMissed: number, suspensionAfterMissed: number,
 *          expulsionAfterMissed: number}} thresholds
 * @param {string} todayIso calendar date, YYYY-MM-DD
 */
function evaluateStanding(member, thresholds, todayIso) {
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
        changedOn: null
    });

    // Expelled is only ever reversed by a resolution; Exited has left the club.
    if (standing === STANDING.EXPELLED) return unchanged("expelled_by_resolution_only");
    if (standing === STANDING.EXITED) return unchanged("exited");

    // Arrears and penalties cleared: back to Good standing, with the date.
    if (arrearsCents <= 0 && penaltiesOutstandingCents <= 0) {
        if (standing === STANDING.GOOD) return unchanged("already_good");
        return {
            standing: STANDING.GOOD,
            changed: true,
            action: "restore_good_standing",
            reason: "arrears_and_penalties_cleared",
            needsResolution: false,
            changedOn: todayIso
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
        action: STEP_ACTION[next],
        reason: "threshold_reached",
        needsResolution: false,
        changedOn: todayIso
    };
}

module.exports = { STANDING, evaluateStanding };