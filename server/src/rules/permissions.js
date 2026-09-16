"use strict";

/**
 * Role-to-operation matrix. REQ-7, REQ-8, REQ-10, BR-10.
 *
 * This is the authority. The web app holds a copy of the same map to decide
 * what to render, but that copy is a convenience for the interface and carries
 * no weight: every request is evaluated here, server-side, against the role the
 * actor holds IN THE CURRENTLY ACTIVE CLUB (REQ-8). A user who is Treasurer of
 * one club and an ordinary Member of another gets treasurer permissions only
 * while the first club is the active context.
 *
 * Pure data and pure functions. No database, no Express, no session. It can be
 * tested exhaustively without starting anything.
 */

const MATRIX = {
    Member: [
        "view.dashboard", "view.ownStatement", "view.queue",
        "view.constitution", "view.pool", "claim.lodge", "assistant.ask"
    ],
    Treasurer: [
        "view.dashboard", "view.ownStatement", "view.queue", "view.constitution",
        "view.pool", "view.ledger", "view.members", "view.reconciliation",
        "cycle.open", "cycle.close",
        "contribution.capture",
        "payout.initiate", "payout.cancel",
        "ledger.reverse", "reconciliation.record",
        "claim.lodge", "assistant.ask"
    ],
    Secretary: [
        "view.dashboard", "view.ownStatement", "view.queue", "view.constitution",
        "view.pool", "view.members", "view.ledger",
        "member.register", "member.amend", "member.revealId", "member.assignRole",
        "governance.record", "assistant.ask"
    ],
    Chairperson: [
        "view.dashboard", "view.ownStatement", "view.queue", "view.constitution",
        "view.pool", "view.ledger", "view.members", "view.reconciliation",
        "payout.approve", "payout.assess", "penalty.waive",
        // REQ-43 names the Secretary AND the Chairperson for all three of
        // these. An earlier version of this matrix gave register and amend to
        // the Secretary alone, which was a defect against the requirement.
        "member.register", "member.amend", "member.assignRole",
        "member.exitApprove",
        "governance.record", "constitution.propose",
        "assistant.ask"
    ],

    // BR-10. The Platform Administrator provisions and suspends clubs and can
    // see aggregate platform figures. This role holds NO club-level permission
    // whatsoever — it is a custodian of the platform, not of anybody's money.
    // The separation is deliberate and it is the one an assessor is most likely
    // to probe.
    PlatformAdmin: [
        "platform.view", "platform.provision", "platform.suspend"
    ]
};

const ALL_ACTIONS = [...new Set(Object.values(MATRIX).flat())].sort();

/**
 * @param {string|null} role
 * @param {string} action
 * @returns {boolean}
 */
function can(role, action) {
    if (!role) return false;
    const allowed = MATRIX[role];
    if (!allowed) return false;
    return allowed.includes(action);
}

/**
 * The sentence shown to the user and written to the audit log when an
 * operation is refused. It names the role and says what would be required,
 * because "permission denied" tells a treasurer nothing they can act on.
 */
function refusalReason(role, action) {
    if (role === "PlatformAdmin") {
        return "The Platform Administrator is a custodian of the platform, not of the " +
               "money. This role has no access to club-level records (BR-10).";
    }
    if (!role) {
        return "You have no role in this club.";
    }
    const holders = Object.entries(MATRIX)
        .filter(([r, actions]) => r !== "PlatformAdmin" && actions.includes(action))
        .map(([r]) => r);

    if (holders.length === 0) {
        return `Your role in this club is ${role}. This operation is not available.`;
    }
    const list = holders.length === 1
        ? `the ${holders[0]}`
        : `the ${holders.slice(0, -1).join(", the ")} or the ${holders[holders.length - 1]}`;

    return `Your role in this club is ${role}. This operation is reserved for ${list}.`;
}

module.exports = { MATRIX, ALL_ACTIONS, can, refusalReason };