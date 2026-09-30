"use strict";

/**
 * Standing engine: gathers each member's position, asks the rules what should
 * happen, saves it and records it. REQ-44, REQ-101 to REQ-103.
 *
 * Nothing here runs by itself; an officer starts a check (see the route).
 * Expulsion is never applied yet: it needs a resolution (T5, Governance), so
 * expulsionApproved is always false and those members are reported instead.
 */

const { withClubTransaction } = require("../../db/tx");
const { todayIso } = require("../../lib/dates");
const { versionInForce } = require("../../rules/versioning");
const { evaluateStanding } = require("../../rules/standing");
const repo = require("./standing.repo");

async function runStandingCheck(clubId, { actorUserId = null, today = todayIso() } = {}) {
    return withClubTransaction(clubId, async (db) => {
        const versions = await repo.listConstitutionVersions(db, clubId);
        const inForce = versionInForce(versions, today);
        if (!inForce) {
            return { ran: false, reason: "no_constitution_in_force", changes: [], awaitingResolution: [] };
        }

        const { warningAfterMissed, suspensionAfterMissed, expulsionAfterMissed } = inForce;
        if ([warningAfterMissed, suspensionAfterMissed, expulsionAfterMissed].some((n) => n == null)) {
            return {
                ran: false,
                reason: "no_standing_thresholds_in_constitution",
                constitutionVersion: inForce.version,
                changes: [],
                awaitingResolution: []
            };
        }
        const thresholds = { warningAfterMissed, suspensionAfterMissed, expulsionAfterMissed };

        const members = await repo.listMemberPositions(db, clubId, {
            graceDays: inForce.gracePeriodDays,
            today
        });

        const changes = [];
        const awaitingResolution = [];

        for (const m of members) {
            const result = evaluateStanding(
                {
                    standing: m.standing,
                    missedContributions: Number(m.missedContributions),
                    arrearsCents: Number(m.arrearsCents),
                    penaltiesOutstandingCents: Number(m.penaltiesOutstandingCents),
                    expulsionApproved: false
                },
                thresholds,
                today
            );

            if (result.needsResolution) awaitingResolution.push(m.memberId);
            if (!result.changed) continue;

            // If someone changed this member in the meantime, leave it alone.
            const moved = await repo.updateStanding(db, clubId, m.memberId, m.standing, result.standing);
            if (!moved) continue;

            await repo.recordChange(db, {
                clubId,
                memberId: m.memberId,
                from: m.standing,
                to: result.standing,
                reason: `${result.action}: ${result.reason}`,
                changedOn: today,
                changedBy: actorUserId
            });
            changes.push({
                memberId: m.memberId,
                from: m.standing,
                to: result.standing,
                action: result.action
            });
        }

        return {
            ran: true,
            constitutionVersion: inForce.version,
            checked: members.length,
            changes,
            awaitingResolution
        };
    });
}

async function standingHistory(clubId, { memberId = null, limit = 100 } = {}) {
    return withClubTransaction(clubId, (db) => repo.listChanges(db, clubId, { memberId, limit }));
}

module.exports = { runStandingCheck, standingHistory };