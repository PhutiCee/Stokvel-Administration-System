"use strict";

/**
 * Burial claim service. Use Case 4. REQ-37, REQ-83 to REQ-88. SDD: assessBurialClaim().
 *
 *     registerDependant(), removeDependant()   REQ-37, prerequisite for a claim to exist against
 *     lodgeClaim()                             REQ-83 to REQ-87: may this claim exist at all
 *     initiateClaimPayment()                   REQ-64, REQ-88: the Treasurer starts paying it
 *     approveClaimPayment()                    REQ-64, REQ-67, REQ-88: a different officer posts it
 *     cancelClaimPayment()                     REQ-70: withdraw before approval
 *
 * REQ-37 (recording dependants) was not itself part of this sprint's assigned
 * scope, but a claim cannot be assessed against a dependant that cannot be
 * recorded, so a minimal version of it lives here rather than blocking REQ-83
 * to REQ-88 on a module of its own. See decisions.md.
 *
 * No Express in this file.
 */

const repo = require("./claims.repo");
const constitutionService = require("../constitution/constitution.service");
const ledgerService = require("../ledger/ledger.service");
const { resolveBenefitAmount, assessLodgement, assessClaimPayment } = require("../../rules/claims");
const { withClubTransaction } = require("../../db/tx");
const { toCents, toNumeric } = require("../../lib/money");
const { todayIso } = require("../../lib/dates");
const { BadRequest, NotFound, RuleRefusal } = require("../../lib/errors");

async function refuse(audit, action, message, detail, target = {}) {
    await audit(action, "Refused", { detail: `Refused: ${message}`, targetType: target.type || "claim", targetId: target.id || null });
    throw new RuleRefusal(message, detail);
}

function requireBurialForNow(clubType) {
    if (clubType === "Burial") return null;
    if (clubType === "Rotating") return "A rotating club pays the pool to one member each cycle, not on a covered dependant's death.";
    return "An accumulating club distributes the pool at year-end, not on a covered dependant's death.";
}

// ---------------------------------------------------------------------------
// REQ-37: dependants
// ---------------------------------------------------------------------------

function canManageDependantsFor(actor, memberId) {
    return actor.memberId === memberId || ["Secretary", "Treasurer", "Chairperson"].includes(actor.role);
}

async function registerDependant(db, { memberId, name, category, dateOfBirth = null }, { actor, audit }) {
    const targetMemberId = memberId || actor.memberId;
    if (!canManageDependantsFor(actor, targetMemberId)) {
        await refuse(audit, "dependant.register", "You can only record dependants for yourself.", {});
    }
    if (!name || !String(name).trim()) throw new BadRequest("Give the dependant's name.");
    if (!category || !String(category).trim()) throw new BadRequest("Give the dependant's category.");

    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        const club = await tx.one(`SELECT club_type FROM club WHERE club_id = $1`, [db.clubId]);
        const notYet = requireBurialForNow(club.club_type);
        if (notYet) return { refused: notYet };

        const constitution = await constitutionService.getVersionInForceOn(tx);
        const known = (constitution.benefitSchedule || []).some(
            (r) => String(r.category).trim().toLowerCase() === String(category).trim().toLowerCase()
        );
        if (!known) {
            return {
                refused: `"${category}" is not a category in the constitution's benefit schedule. Categories in force: ` +
                    (constitution.benefitSchedule || []).map((r) => r.category).join(", ") || "(none set)"
            };
        }
        const created = await repo.insertDependant(tx, { memberId: targetMemberId, name: String(name).trim(), category: String(category).trim(), dateOfBirth });
        return { created };
    });

    if (outcome.refused) await refuse(audit, "dependant.register", outcome.refused, { requirement: "REQ-37" });

    await audit("dependant.register", "Success", {
        detail: `${actor.fullName} recorded ${outcome.created.name} (${outcome.created.category}) as a covered dependant.`,
        targetType: "dependant", targetId: outcome.created.dependantId
    });
    return outcome.created;
}

async function removeDependant(db, dependantId, { actor, audit }) {
    const d = await repo.getDependant(db, dependantId);
    if (!d) throw new NotFound("That dependant was not found in this club.");
    if (!canManageDependantsFor(actor, d.memberId)) {
        await refuse(audit, "dependant.remove", "You can only remove your own dependants.", {}, { type: "dependant", id: dependantId });
    }
    if (d.removedAt) throw new BadRequest("That dependant's cover has already ended.");

    const err = await withClubTransaction(db.clubId, async (tx) => {
        try {
            await repo.removeDependant(tx, dependantId);
            return null;
        } catch (e) {
            if (e.code === "23001" || /restrict_violation/i.test(e.message || "")) return "This dependant has a claim on record and cannot be removed.";
            throw e;
        }
    });
    if (err) await refuse(audit, "dependant.remove", err, {}, { type: "dependant", id: dependantId });

    await audit("dependant.remove", "Success", { detail: `${actor.fullName} ended cover for ${d.name}.`, targetType: "dependant", targetId: dependantId });
    return { dependantId, removed: true };
}

async function listMyDependants(db, { actor }) {
    return repo.listDependants(db, actor.memberId);
}

// ---------------------------------------------------------------------------
// lodgeClaim()  REQ-83 to REQ-87
// ---------------------------------------------------------------------------

async function lodgeClaim(db, { dependantId, dateOfDeath, description = null }, { actor, audit }) {
    if (!dependantId) throw new BadRequest("Name the dependant this claim is for.");
    if (!dateOfDeath) throw new BadRequest("Give the date of death, YYYY-MM-DD.");

    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        const club = await tx.one(`SELECT club_type FROM club WHERE club_id = $1`, [db.clubId]);
        const notYet = requireBurialForNow(club.club_type);
        if (notYet) return { refused: notYet, detail: { requirement: "REQ-83" } };

        const claimant = await repo.getMember(tx, actor.memberId);
        const dependant = await repo.getDependant(tx, dependantId);
        const today = todayIso();

        // REQ-86: resolved against the constitution in force on the date of
        // death. REQ-87 is checked separately, against today — see decisions.md.
        let constitutionAtDeath = null;
        if (dependant) {
            try {
                constitutionAtDeath = await constitutionService.getVersionInForceOn(tx, dateOfDeath);
            } catch {
                constitutionAtDeath = null; // no constitution yet on that date; the date check below will refuse
            }
        }
        const constitutionToday = await constitutionService.getVersionInForceOn(tx);

        const alreadyClaimed = dependant ? !!(await repo.existingClaimForDependant(tx, dependantId)) : false;

        const assessment = assessLodgement({
            clubType: club.club_type,
            claimantStanding: claimant.standing,
            dependant: dependant ? { memberId: dependant.memberId, category: dependant.category, registeredAt: dependant.registeredAt, removedAt: dependant.removedAt } : null,
            claimantMemberId: actor.memberId,
            dateOfDeath, today,
            memberJoinDate: claimant.join_date,
            waitingPeriodDays: Number(constitutionToday.waitingPeriodDays || 0),
            alreadyClaimed
        });
        if (assessment.refusals.length > 0) {
            return { refused: assessment.refusals.map((r) => r.message).join(" "), detail: { refusals: assessment.refusals } };
        }

        const benefit = resolveBenefitAmount(constitutionAtDeath.benefitSchedule, dependant.category);
        if (!benefit.ok) {
            return { refused: benefit.reason, detail: { requirement: "REQ-86" } };
        }

        const created = await repo.insertClaim(tx, {
            memberId: actor.memberId, dependantId, dateOfDeath, description,
            constitutionVersion: constitutionAtDeath.version,
            dependantCategory: dependant.category,
            benefitAmount: toNumeric(benefit.amountCents),
            lodgedBy: actor.userId
        });
        return { claimId: created.claim_id, dependantName: dependant.name, amount: toNumeric(benefit.amountCents) };
    });

    if (outcome.refused) await refuse(audit, "claim.lodge", outcome.refused, outcome.detail);

    await audit("claim.lodge", "Success", {
        detail: `${actor.fullName} lodged a claim for ${outcome.dependantName}, date of death ${dateOfDeath}. Benefit R${outcome.amount}.`,
        targetType: "claim", targetId: outcome.claimId
    });
    return getClaim(db, outcome.claimId);
}

// ---------------------------------------------------------------------------
// Presentation
// ---------------------------------------------------------------------------

function presentClaim(c) {
    return {
        claimId: c.claim_id, status: c.status,
        dependant: { dependantId: c.dependant_id, name: c.dependant_name, category: c.dependant_category },
        claimant: { memberId: c.member_id, fullName: c.claimant_name },
        dateOfDeath: c.date_of_death, description: c.description,
        constitutionVersion: c.constitution_version, benefitAmount: c.benefit_amount,
        lodged: { by: c.lodged_by_name, userId: c.lodged_by, at: c.lodged_at },
        initiated: c.initiated_by ? { by: c.initiated_by_name, userId: c.initiated_by, at: c.initiated_at } : null,
        approved: c.approved_by ? { by: c.approved_by_name, userId: c.approved_by, at: c.approved_at } : null,
        cancelled: c.cancelled_by ? { by: c.cancelled_by_name, userId: c.cancelled_by, at: c.cancelled_at, reason: c.cancel_reason } : null
    };
}

async function listClaims(db, { actor, mine = false }) {
    const rows = await repo.listClaims(db, mine ? { memberId: actor.memberId } : {});
    return rows.map(presentClaim);
}

async function checkPaymentNow(db, c) {
    const claimant = await repo.getMember(db, c.member_id);
    const poolCents = toCents((await ledgerService.getPoolBalance(db)).balance);
    const oldest = await repo.oldestLodgedClaim(db);
    return assessClaimPayment({
        claimantStanding: claimant.standing,
        benefitCents: toCents(c.benefit_amount),
        poolCents,
        isOldestUnresolved: c.status !== "Lodged" || !oldest || oldest.claim_id === c.claim_id,
        oldestLodgedAt: oldest ? oldest.lodged_at : null
    });
}

async function getClaim(db, claimId) {
    const c = await repo.getClaim(db, claimId);
    if (!c) throw new NotFound("That claim was not found in this club.");
    const out = presentClaim(c);
    if (c.status === "Lodged" || c.status === "Initiated") {
        const v = await checkPaymentNow(db, c);
        out.paymentAssessment = v;
    }
    return out;
}

// ---------------------------------------------------------------------------
// initiateClaimPayment()  REQ-64, REQ-88
// ---------------------------------------------------------------------------

async function initiateClaimPayment(db, claimId, { actor, audit }) {
    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        await repo.lockClub(tx);
        const c = await repo.getClaim(tx, claimId, { forUpdate: true });
        if (!c) return { notFound: true };
        if (c.status !== "Lodged") return { refused: `This claim is ${c.status.toLowerCase()} and cannot be initiated for payment.`, detail: { requirement: "REQ-64" } };
        if (await repo.openClaim(tx)) return { refused: "A claim payment is already waiting for approval. It must be approved or cancelled before another is started.", detail: { requirement: "REQ-64" } };

        const v = await checkPaymentNow(tx, c);
        if (!v.eligible) return { refused: v.refusals.map((r) => r.message).join(" "), detail: { requirement: [...new Set(v.refusals.map((r) => r.requirement))].join(", "), refusals: v.refusals }, c };

        const rule =
            `Burial society, constitution version ${c.constitution_version}. Benefit for category "${c.dependant_category}": ` +
            `R${c.benefit_amount}, paid to ${c.claimant_name} on the death of ${c.dependant_name} (${c.date_of_death}).`;
        const created = await repo.insertClaimPayout(tx, {
            memberId: c.member_id, amount: c.benefit_amount, claimId,
            constitutionVersion: c.constitution_version, rule,
            assessment: { benefitAmount: c.benefit_amount }, initiatedBy: actor.userId
        });
        await repo.markInitiated(tx, claimId, { initiatedBy: actor.userId });
        return { c, payoutId: created.payout_id };
    });

    if (outcome.notFound) throw new NotFound("That claim was not found in this club.");
    if (outcome.refused) await refuse(audit, "claim.initiate", outcome.refused, outcome.detail, { id: claimId });

    await audit("claim.initiate", "Success", {
        detail: `${actor.fullName} initiated payment of R${outcome.c.benefit_amount} to ${outcome.c.claimant_name} for the claim on ${outcome.c.dependant_name}. It is waiting for the Chairperson's approval.`,
        targetType: "claim", targetId: claimId
    });
    return getClaim(db, claimId);
}

// ---------------------------------------------------------------------------
// approveClaimPayment()  REQ-64, REQ-67, REQ-88
// ---------------------------------------------------------------------------

async function approveClaimPayment(db, claimId, { actor, audit }) {
    const outcome = await withClubTransaction(db.clubId, async (tx, client) => {
        await repo.lockClub(tx);
        const c = await repo.getClaim(tx, claimId, { forUpdate: true });
        if (!c) return { notFound: true };
        if (c.status !== "Initiated") return { refused: `This claim's payment is ${c.status.toLowerCase()} and cannot be approved.`, detail: { requirement: "REQ-64" }, c };
        if (c.initiated_by === actor.userId) return { refused: "You initiated this payment, so you cannot approve it. Another officer must approve it (REQ-64).", detail: { requirement: "REQ-64", rule: "BR-2" }, c };

        const v = await checkPaymentNow(tx, c);
        if (!v.eligible) return { refused: v.refusals.map((r) => r.message).join(" "), detail: { requirement: [...new Set(v.refusals.map((r) => r.requirement))].join(", "), refusals: v.refusals }, c };

        const payout = await repo.getPayoutForClaim(tx, claimId);
        const entry = await ledgerService.appendEntry(client, {
            clubId: db.clubId, memberId: c.member_id, entryType: "Payout",
            amount: toNumeric(-toCents(c.benefit_amount)),
            description: `Burial claim, ${c.dependant_name}, ${c.date_of_death}`,
            postedBy: actor.userId, payoutId: payout.payout_id
        });
        await repo.markClaimPayoutApproved(tx, payout.payout_id, { approvedBy: actor.userId, assessment: { postedAmount: entry.amount } });
        await repo.markApproved(tx, claimId, { approvedBy: actor.userId });
        return { c, resultingBalance: entry.resultingBalance };
    });

    if (outcome.notFound) throw new NotFound("That claim was not found in this club.");
    if (outcome.refused) await refuse(audit, "claim.approve", outcome.refused, outcome.detail, { id: claimId });

    await audit("claim.approve", "Success", {
        detail: `${actor.fullName} approved the payment of R${outcome.c.benefit_amount} to ${outcome.c.claimant_name}, initiated by ${outcome.c.initiated_by_name}. Pool balance now R${outcome.resultingBalance}.`,
        targetType: "claim", targetId: claimId
    });
    return getClaim(db, claimId);
}

// ---------------------------------------------------------------------------
// cancelClaimPayment()  REQ-70
// ---------------------------------------------------------------------------

async function cancelClaimPayment(db, claimId, { reason }, { actor, audit }) {
    if (!reason || !String(reason).trim()) throw new BadRequest("Record why this claim is being cancelled.");

    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        await repo.lockClub(tx);
        const c = await repo.getClaim(tx, claimId, { forUpdate: true });
        if (!c) return { notFound: true };
        if (!["Lodged", "Initiated"].includes(c.status)) return { refused: `This claim is ${c.status.toLowerCase()} and cannot be cancelled.`, c };

        if (c.status === "Initiated") {
            const payout = await repo.getPayoutForClaim(tx, claimId);
            await repo.markClaimPayoutCancelled(tx, payout.payout_id, { cancelledBy: actor.userId, reason: String(reason).trim() });
        }
        await repo.markCancelled(tx, claimId, { cancelledBy: actor.userId, reason: String(reason).trim() });
        return { c };
    });

    if (outcome.notFound) throw new NotFound("That claim was not found in this club.");
    if (outcome.refused) await refuse(audit, "claim.cancel", outcome.refused, { requirement: "REQ-70" }, { id: claimId });

    await audit("claim.cancel", "Success", {
        detail: `${actor.fullName} cancelled the claim on ${outcome.c.dependant_name}. Reason: ${String(reason).trim()}`,
        targetType: "claim", targetId: claimId
    });
    return getClaim(db, claimId);
}

module.exports = {
    registerDependant, removeDependant, listMyDependants,
    lodgeClaim, listClaims, getClaim,
    initiateClaimPayment, approveClaimPayment, cancelClaimPayment
};