"use strict";

/**
 * Standing engine service. REQ-44, REQ-101 to REQ-103.
 *
 * An officer starts a check (see standing.routes.js); nothing here runs by
 * itself. Every change from one check happens in ONE transaction, so a check
 * applies completely or not at all. Expulsion is never applied yet: it needs a
 * resolution (T5, Governance), so those members are reported instead.
 */

const { withClubTransaction } = require("../../db/tx");
const { todayIso } = require("../../lib/dates");
const { versionInForce } = require("../../rules/versioning");
const { evaluateStanding } = require("../../rules/standing");
const repo = require("./standing.repo");

async function runStandingCheck(db, { actor = null, audit = null, today = todayIso() } = {}) {
    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        const versions = await repo.listConstitutionVersions(tx, tx.clubId);
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
        const thresholds = {
            warningAfterMissed: Number(warningAfterMissed),
            suspensionAfterMissed: Number(suspensionAfterMissed),
            expulsionAfterMissed: Number(expulsionAfterMissed)
        };

        const members = await repo.listMemberPositions(tx, tx.clubId, {
            graceDays: Number(inForce.gracePeriodDays || 0),
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
            const moved = await repo.updateStanding(tx, tx.clubId, m.memberId, m.standing, result.standing);
            if (!moved) continue;

            await repo.recordChange(tx, {
                clubId: tx.clubId,
                memberId: m.memberId,
                from: m.standing,
                to: result.standing,
                reason: `${result.action}: ${result.reason}`,
                changedOn: result.changedOn,
                changedBy: actor ? actor.userId : null
            });
            changes.push({ memberId: m.memberId, from: m.standing, to: result.standing, action: result.action });
        }

        return {
            ran: true,
            constitutionVersion: inForce.version,
            checked: members.length,
            changes,
            awaitingResolution
        };
    });

    if (audit) {
        for (const c of outcome.changes) {
            await audit("standing.change", "Success", {
                detail:
                    `${actor ? actor.fullName : "The system"} ran a standing check: ` +
                    `a member moved from ${c.from} to ${c.to} (${c.action}).`,
                targetType: "member",
                targetId: c.memberId
            });
        }
    }

    return outcome;
}

async function standingHistory(db, { memberId = null, limit = 100 } = {}) {
    return repo.listChanges(db, db.clubId, { memberId, limit });
}

module.exports = { runStandingCheck, standingHistory };