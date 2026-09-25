"use strict";

/**
 * Burial claim repo. SQL only, no rules.
 *
 * Covers both the dependant records a claim is assessed against (REQ-37) and
 * the claim itself (REQ-83). Dates are selected as text (lib/dates.js).
 */

async function lockClub(db) {
    return db.one(`SELECT club_id, club_type FROM club WHERE club_id = $1 FOR UPDATE`, [db.clubId]);
}

async function getMember(db, memberId) {
    return db.one(
        `SELECT m.member_id, m.standing, m.join_date::text AS join_date, u.full_name
           FROM member m JOIN user_account u ON u.user_id = m.user_id
          WHERE m.club_id = $1 AND m.member_id = $2`,
        [db.clubId, memberId]
    );
}

// --- dependants (REQ-37) ----------------------------------------------------

function presentDependant(r) {
    return {
        dependantId: r.dependant_id, memberId: r.member_id, name: r.name, category: r.category,
        dateOfBirth: r.date_of_birth, registeredAt: r.registered_at, removedAt: r.removed_at
    };
}

async function listDependants(db, memberId) {
    const rows = await db.many(
        `SELECT dependant_id, member_id, name, category,
                date_of_birth::text AS date_of_birth,
                registered_at::text AS registered_at,
                removed_at::text    AS removed_at
           FROM dependant WHERE club_id = $1 AND member_id = $2
          ORDER BY registered_at ASC`,
        [db.clubId, memberId]
    );
    return rows.map(presentDependant);
}

async function getDependant(db, dependantId) {
    const r = await db.one(
        `SELECT dependant_id, member_id, name, category,
                date_of_birth::text AS date_of_birth,
                registered_at::text AS registered_at,
                removed_at::text    AS removed_at
           FROM dependant WHERE club_id = $1 AND dependant_id = $2`,
        [db.clubId, dependantId]
    );
    return r ? presentDependant(r) : null;
}

async function insertDependant(db, { memberId, name, category, dateOfBirth }) {
    const r = await db.one(
        `INSERT INTO dependant (club_id, member_id, name, category, date_of_birth)
         VALUES ($1, $2, $3, $4, $5::date)
         RETURNING dependant_id, member_id, name, category,
                   date_of_birth::text AS date_of_birth,
                   registered_at::text AS registered_at,
                   removed_at::text    AS removed_at`,
        [db.clubId, memberId, name, category, dateOfBirth || null]
    );
    return presentDependant(r);
}

async function removeDependant(db, dependantId) {
    await db.query(
        `UPDATE dependant SET removed_at = CURRENT_DATE WHERE club_id = $1 AND dependant_id = $2 AND removed_at IS NULL`,
        [db.clubId, dependantId]
    );
}

// --- claims (REQ-83 to REQ-88) ----------------------------------------------

async function existingClaimForDependant(db, dependantId) {
    return db.one(
        `SELECT claim_id, status FROM burial_claim WHERE club_id = $1 AND dependant_id = $2 AND status <> 'Cancelled'`,
        [db.clubId, dependantId]
    );
}

/** The earliest still-open (Lodged) claim, if any — the only one REQ-88 allows to be paid next. */
async function oldestLodgedClaim(db) {
    return db.one(
        `SELECT claim_id, lodged_at::text AS lodged_at FROM burial_claim
          WHERE club_id = $1 AND status = 'Lodged'
          ORDER BY lodged_at ASC LIMIT 1`,
        [db.clubId]
    );
}

async function openClaim(db) {
    return db.one(`SELECT claim_id FROM burial_claim WHERE club_id = $1 AND status = 'Initiated'`, [db.clubId]);
}

const COLUMNS = `
    c.claim_id, c.status, c.date_of_death::text AS date_of_death, c.description,
    c.constitution_version, c.dependant_category, c.benefit_amount,
    c.member_id, mu.full_name AS claimant_name,
    c.dependant_id, d.name AS dependant_name,
    c.lodged_by, lu.full_name AS lodged_by_name, c.lodged_at::text AS lodged_at,
    c.initiated_by, iu.full_name AS initiated_by_name, c.initiated_at,
    c.approved_by,  au.full_name AS approved_by_name,  c.approved_at,
    c.cancelled_by, cu.full_name AS cancelled_by_name, c.cancelled_at, c.cancel_reason`;

const JOINS = `
    FROM burial_claim c
    JOIN member m ON m.member_id = c.member_id
    JOIN user_account mu ON mu.user_id = m.user_id
    JOIN dependant d ON d.dependant_id = c.dependant_id
    JOIN user_account lu ON lu.user_id = c.lodged_by
    LEFT JOIN user_account iu ON iu.user_id = c.initiated_by
    LEFT JOIN user_account au ON au.user_id = c.approved_by
    LEFT JOIN user_account cu ON cu.user_id = c.cancelled_by`;

async function getClaim(db, claimId, { forUpdate = false } = {}) {
    if (forUpdate) {
        await db.query(`SELECT claim_id FROM burial_claim WHERE club_id = $1 AND claim_id = $2 FOR UPDATE`, [db.clubId, claimId]);
    }
    return db.one(`SELECT ${COLUMNS} ${JOINS} WHERE c.club_id = $1 AND c.claim_id = $2`, [db.clubId, claimId]);
}

async function listClaims(db, { memberId = null, limit = 50 } = {}) {
    return db.many(
        `SELECT ${COLUMNS} ${JOINS}
          WHERE c.club_id = $1 ${memberId ? "AND c.member_id = $3" : ""}
          ORDER BY c.lodged_at DESC LIMIT $2`,
        memberId ? [db.clubId, limit, memberId] : [db.clubId, limit]
    );
}

async function insertClaim(db, c) {
    return db.one(
        `INSERT INTO burial_claim
             (club_id, member_id, dependant_id, date_of_death, description,
              constitution_version, dependant_category, benefit_amount, lodged_by)
         VALUES ($1, $2, $3, $4::date, $5, $6, $7, $8, $9)
         RETURNING claim_id`,
        [db.clubId, c.memberId, c.dependantId, c.dateOfDeath, c.description || null,
         c.constitutionVersion, c.dependantCategory, c.benefitAmount, c.lodgedBy]
    );
}

async function markInitiated(db, claimId, { initiatedBy }) {
    await db.query(
        `UPDATE burial_claim SET status = 'Initiated', initiated_by = $3, initiated_at = now()
          WHERE club_id = $1 AND claim_id = $2`,
        [db.clubId, claimId, initiatedBy]
    );
}

async function markApproved(db, claimId, { approvedBy }) {
    await db.query(
        `UPDATE burial_claim SET status = 'Approved', approved_by = $3, approved_at = now()
          WHERE club_id = $1 AND claim_id = $2`,
        [db.clubId, claimId, approvedBy]
    );
}

async function markCancelled(db, claimId, { cancelledBy, reason }) {
    await db.query(
        `UPDATE burial_claim SET status = 'Cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4
          WHERE club_id = $1 AND claim_id = $2`,
        [db.clubId, claimId, cancelledBy, reason]
    );
}

// --- the claim's own payout row --------------------------------------------

async function insertClaimPayout(db, p) {
    return db.one(
        `INSERT INTO payout
             (club_id, member_id, payout_type, amount, claim_id,
              constitution_version, eligibility_rule_applied, assessment_at_initiation, initiated_by)
         VALUES ($1, $2, 'Burial claim', $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING payout_id`,
        [db.clubId, p.memberId, p.amount, p.claimId, p.constitutionVersion, p.rule, JSON.stringify(p.assessment), p.initiatedBy]
    );
}

async function getPayoutForClaim(db, claimId) {
    return db.one(`SELECT payout_id, amount FROM payout WHERE club_id = $1 AND claim_id = $2`, [db.clubId, claimId]);
}

async function markClaimPayoutApproved(db, payoutId, { approvedBy, assessment }) {
    await db.query(
        `UPDATE payout SET status = 'Approved', approved_by = $3, approved_at = now(), assessment_at_approval = $4::jsonb
          WHERE club_id = $1 AND payout_id = $2`,
        [db.clubId, payoutId, approvedBy, JSON.stringify(assessment)]
    );
}

async function markClaimPayoutCancelled(db, payoutId, { cancelledBy, reason }) {
    await db.query(
        `UPDATE payout SET status = 'Cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4
          WHERE club_id = $1 AND payout_id = $2`,
        [db.clubId, payoutId, cancelledBy, reason]
    );
}

module.exports = {
    lockClub, getMember,
    listDependants, getDependant, insertDependant, removeDependant,
    existingClaimForDependant, oldestLodgedClaim, openClaim,
    getClaim, listClaims, insertClaim, markInitiated, markApproved, markCancelled,
    insertClaimPayout, getPayoutForClaim, markClaimPayoutApproved, markClaimPayoutCancelled
};