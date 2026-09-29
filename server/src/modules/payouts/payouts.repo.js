"use strict";

/**
 * Payout repo. SQL only, no rules.
 *
 * Amounts stay NUMERIC strings, as everywhere else (lib/money.js does the
 * arithmetic, in cents). Dates are selected as text (lib/dates.js).
 */

const COLUMNS = `
    p.payout_id, p.status, p.payout_type, p.amount,
    p.member_id, ru.full_name AS recipient_name,
    p.cycle_id, cy.sequence_number AS cycle_sequence,
    p.constitution_version, p.eligibility_rule_applied,
    p.assessment_at_initiation, p.assessment_at_approval,
    p.arrears_decision_id,
    p.initiated_by, iu.full_name AS initiated_by_name, p.initiated_at,
    p.approved_by,  au.full_name AS approved_by_name,  p.approved_at,
    p.cancelled_by, cu.full_name AS cancelled_by_name, p.cancelled_at, p.cancel_reason,
    (SELECT l.entry_id FROM ledger_entry l
      WHERE l.club_id = p.club_id AND l.payout_id = p.payout_id
        AND l.reverses_id IS NULL) AS ledger_entry_id`;

const JOINS = `
    FROM payout p
    JOIN member rm       ON rm.member_id = p.member_id
    JOIN user_account ru ON ru.user_id   = rm.user_id
    JOIN user_account iu ON iu.user_id   = p.initiated_by
    LEFT JOIN user_account au ON au.user_id = p.approved_by
    LEFT JOIN user_account cu ON cu.user_id = p.cancelled_by
    LEFT JOIN cycle cy   ON cy.cycle_id  = p.cycle_id`;

async function getPayout(db, payoutId, { forUpdate = false } = {}) {
    if (forUpdate) {
        // Lock the payout row on its own. FOR UPDATE cannot be applied across
        // the outer joins below.
        await db.query(
            `SELECT payout_id FROM payout WHERE club_id = $1 AND payout_id = $2 FOR UPDATE`,
            [db.clubId, payoutId]
        );
    }
    return db.one(
        `SELECT ${COLUMNS} ${JOINS} WHERE p.club_id = $1 AND p.payout_id = $2`,
        [db.clubId, payoutId]
    );
}

async function listPayouts(db, { limit = 100 } = {}) {
    return db.many(
        `SELECT ${COLUMNS} ${JOINS}
          WHERE p.club_id = $1
          ORDER BY p.initiated_at DESC
          LIMIT ${Number(limit)}`,
        [db.clubId]
    );
}

async function openRotationPayout(db) {
    return db.one(
        `SELECT payout_id FROM payout
          WHERE club_id = $1 AND payout_type = 'Rotation' AND status = 'Initiated'`,
        [db.clubId]
    );
}

/** What the members of a cycle have put in, and how many are not yet paid up. */
async function cycleTotals(db, cycleId) {
    return db.one(
        `SELECT COALESCE(sum(captured_amount), 0) AS captured,
                COALESCE(sum(expected_amount), 0) AS expected,
                count(*) FILTER (WHERE captured_amount < expected_amount)::int AS members_short
           FROM contribution
          WHERE club_id = $1 AND cycle_id = $2`,
        [db.clubId, cycleId]
    );
}

async function getCycle(db, cycleId) {
    return db.one(
        `SELECT cycle_id, sequence_number, status,
                start_date::text AS start_date, due_date::text AS due_date
           FROM cycle WHERE club_id = $1 AND cycle_id = $2`,
        [db.clubId, cycleId]
    );
}

async function getMember(db, memberId) {
    return db.one(
        `SELECT m.member_id, m.standing, m.queue_position, u.full_name
           FROM member m JOIN user_account u ON u.user_id = m.user_id
          WHERE m.club_id = $1 AND m.member_id = $2`,
        [db.clubId, memberId]
    );
}

async function insertPayout(db, p) {
    return db.one(
        `INSERT INTO payout
             (club_id, member_id, payout_type, amount, cycle_id,
              constitution_version, eligibility_rule_applied,
              assessment_at_initiation, arrears_decision_id, initiated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9, $10)
         RETURNING payout_id`,
        [db.clubId, p.memberId, p.payoutType, p.amount, p.cycleId,
         p.constitutionVersion, p.rule, JSON.stringify(p.assessment),
         p.arrearsDecisionId, p.initiatedBy]
    );
}

async function markApproved(db, payoutId, { approvedBy, assessment }) {
    await db.query(
        `UPDATE payout
            SET status = 'Approved', approved_by = $3, approved_at = now(),
                assessment_at_approval = $4::jsonb
          WHERE club_id = $1 AND payout_id = $2`,
        [db.clubId, payoutId, approvedBy, JSON.stringify(assessment)]
    );
}

async function markCancelled(db, payoutId, { cancelledBy, reason }) {
    await db.query(
        `UPDATE payout
            SET status = 'Cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4
          WHERE club_id = $1 AND payout_id = $2`,
        [db.clubId, payoutId, cancelledBy, reason]
    );
}

module.exports = {
    getPayout, listPayouts, openRotationPayout, cycleTotals, getCycle, getMember,
    insertPayout, markApproved, markCancelled
};