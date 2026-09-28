"use strict";

/**
 * Penalty waiver rule. REQ-63, BR-13.
 *
 * Small on purpose: a waiver has only two ways to be refused, both about the
 * request itself rather than about money (there is no amount to check —
 * REQ-63 reverses exactly what was levied, nothing else). The interesting
 * part of REQ-63 is the reversing entry, which belongs to the ledger
 * (lib/money.js, ledger.service.js), not to a rule of its own.
 *
 * Pure function. No database, no Express.
 */

function assessWaiver({ alreadyWaived, reason }) {
    const refusals = [];
    if (alreadyWaived) {
        refusals.push({ requirement: "BR-13", code: "ALREADY_WAIVED", message: "This penalty has already been waived." });
    }
    if (!reason || !String(reason).trim()) {
        refusals.push({ requirement: "REQ-63", code: "REASON_REQUIRED", message: "Record the reason for waiving this penalty." });
    }
    return { eligible: refusals.length === 0, refusals };
}

module.exports = { assessWaiver };