"use strict";

/**
 * Distribution repo. SQL only, no rules.
 *
 * Dates are selected as text (lib/dates.js). Money stays NUMERIC strings at
 * the boundary; rules/distributions.js works in integer cents (lib/money.js).
 */

async function lockClub(db) {
    return db.one(
        `SELECT club_id, club_type, registration_date::text AS registration_date
           FROM club WHERE club_id = $1 FOR UPDATE`,
        [db.clubId]
    );
}

/** The most recently Approved distribution, if any. Its period_end anchors the next one. */
async function lastApprovedDistribution(db) {
    return db.one(
        `SELECT distribution_id, year_end_date::text AS year_end_date, period_end::text AS period_end
           FROM distribution
          WHERE club_id = $1 AND status = 'Approved'
          ORDER BY period_end DESC
          LIMIT 1`,
        [db.clubId]
    );
}

/** A live (not Cancelled) distribution already covering this exact year-end date, if any. */
async function existingForYearEnd(db, yearEndDate) {
    return db.one(
        `SELECT distribution_id, status FROM distribution
          WHERE club_id = $1 AND year_end_date = $2::date AND status <> 'Cancelled'`,
        [db.clubId, yearEndDate]
    );
}

async function openDistribution(db) {
    return db.one(
        `SELECT distribution_id FROM distribution WHERE club_id = $1 AND status = 'Initiated'`,
        [db.clubId]
    );
}

/**
 * Every current member (REQ-79 covers current members; a member who has
 * already exited is settled separately, see decisions.md) with their captured
 * contributions and unwaived penalties for the period. periodStart is
 * exclusive, periodEnd is inclusive.
 */
async function periodMemberTotals(db, { periodStart, periodEnd }) {
    return db.many(
        `WITH captured AS (
             SELECT ct.member_id, COALESCE(sum(ct.captured_amount), 0) AS captured
               FROM contribution ct
               JOIN cycle cy ON cy.cycle_id = ct.cycle_id
              WHERE ct.club_id = $1 AND cy.due_date > $2::date AND cy.due_date <= $3::date
              GROUP BY ct.member_id
         ), penalties AS (
             SELECT p.member_id, COALESCE(sum(p.amount), 0) AS penalties
               FROM penalty p
              WHERE p.club_id = $1 AND p.waived_at IS NULL
                AND p.levied_at::date > $2::date AND p.levied_at::date <= $3::date
              GROUP BY p.member_id
         )
         SELECT m.member_id, u.full_name, m.standing,
                COALESCE(c.captured, 0)  AS captured,
                COALESCE(pe.penalties, 0) AS penalties
           FROM member m
           JOIN user_account u ON u.user_id = m.user_id
           LEFT JOIN captured  c  ON c.member_id  = m.member_id
           LEFT JOIN penalties pe ON pe.member_id = m.member_id
          WHERE m.club_id = $1 AND m.standing <> 'Exited'
          ORDER BY u.full_name ASC`,
        [db.clubId, periodStart, periodEnd]
    );
}

/** REQ-80: interest earned and administrative costs posted during the period. */
async function periodFinancialTotals(db, { periodStart, periodEnd }) {
    return db.one(
        `SELECT COALESCE(sum(amount)  FILTER (WHERE entry_type = 'Interest'), 0) AS interest,
                COALESCE(sum(-amount) FILTER (WHERE entry_type = 'Expense'),  0) AS expenses
           FROM ledger_entry
          WHERE club_id = $1 AND posted_at::date > $2::date AND posted_at::date <= $3::date`,
        [db.clubId, periodStart, periodEnd]
    );
}

const COLUMNS = `
    d.distribution_id, d.status, d.year_end_date::text AS year_end_date,
    d.period_start::text AS period_start, d.period_end::text AS period_end,
    d.constitution_version,
    d.total_contributions, d.total_penalties, d.total_interest, d.total_expenses,
    d.total_distributed, d.pool_at_computation,
    d.assessment_at_initiation, d.assessment_at_approval,
    d.initiated_by, iu.full_name AS initiated_by_name, d.initiated_at,
    d.approved_by,  au.full_name AS approved_by_name,  d.approved_at,
    d.cancelled_by, cu.full_name AS cancelled_by_name, d.cancelled_at, d.cancel_reason`;

const JOINS = `
    FROM distribution d
    JOIN user_account iu ON iu.user_id = d.initiated_by
    LEFT JOIN user_account au ON au.user_id = d.approved_by
    LEFT JOIN user_account cu ON cu.user_id = d.cancelled_by`;

async function getDistribution(db, distributionId, { forUpdate = false } = {}) {
    if (forUpdate) {
        await db.query(
            `SELECT distribution_id FROM distribution WHERE club_id = $1 AND distribution_id = $2 FOR UPDATE`,
            [db.clubId, distributionId]
        );
    }
    return db.one(`SELECT ${COLUMNS} ${JOINS} WHERE d.club_id = $1 AND d.distribution_id = $2`, [db.clubId, distributionId]);
}

async function listDistributions(db, { limit = 25 } = {}) {
    return db.many(
        `SELECT ${COLUMNS} ${JOINS} WHERE d.club_id = $1 ORDER BY d.initiated_at DESC LIMIT ${Number(limit)}`,
        [db.clubId]
    );
}

async function insertDistribution(db, d) {
    return db.one(
        `INSERT INTO distribution
             (club_id, year_end_date, period_start, period_end, constitution_version,
              total_contributions, total_penalties, total_interest, total_expenses,
              total_distributed, pool_at_computation, assessment_at_initiation, initiated_by)
         VALUES ($1, $2::date, $3::date, $4::date, $5, $6, $7, $8, $9, $10, $11, $12::jsonb, $13)
         RETURNING distribution_id`,
        [db.clubId, d.yearEndDate, d.periodStart, d.periodEnd, d.constitutionVersion,
         d.totalContributions, d.totalPenalties, d.totalInterest, d.totalExpenses,
         d.totalDistributed, d.poolAtComputation, JSON.stringify(d.assessment), d.initiatedBy]
    );
}

async function insertMemberPayout(db, p) {
    return db.one(
        `INSERT INTO payout
             (club_id, member_id, payout_type, amount, distribution_id,
              constitution_version, eligibility_rule_applied, assessment_at_initiation, initiated_by)
         VALUES ($1, $2, 'Distribution', $3, $4, $5, $6, $7::jsonb, $8)
         RETURNING payout_id`,
        [db.clubId, p.memberId, p.amount, p.distributionId,
         p.constitutionVersion, p.rule, JSON.stringify(p.assessment), p.initiatedBy]
    );
}

async function listMemberPayouts(db, distributionId) {
    return db.many(
        `SELECT p.payout_id, p.member_id, p.amount, u.full_name
           FROM payout p JOIN member m ON m.member_id = p.member_id
           JOIN user_account u ON u.user_id = m.user_id
          WHERE p.club_id = $1 AND p.distribution_id = $2`,
        [db.clubId, distributionId]
    );
}

async function markApproved(db, distributionId, { approvedBy, assessment }) {
    await db.query(
        `UPDATE distribution SET status = 'Approved', approved_by = $3, approved_at = now(), assessment_at_approval = $4::jsonb
          WHERE club_id = $1 AND distribution_id = $2`,
        [db.clubId, distributionId, approvedBy, JSON.stringify(assessment)]
    );
}

async function markCancelled(db, distributionId, { cancelledBy, reason }) {
    await db.query(
        `UPDATE distribution SET status = 'Cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4
          WHERE club_id = $1 AND distribution_id = $2`,
        [db.clubId, distributionId, cancelledBy, reason]
    );
}

async function markMemberPayoutApproved(db, payoutId, { approvedBy, assessment }) {
    await db.query(
        `UPDATE payout SET status = 'Approved', approved_by = $3, approved_at = now(), assessment_at_approval = $4::jsonb
          WHERE club_id = $1 AND payout_id = $2`,
        [db.clubId, payoutId, approvedBy, JSON.stringify(assessment)]
    );
}

async function markMemberPayoutCancelled(db, payoutId, { cancelledBy, reason }) {
    await db.query(
        `UPDATE payout SET status = 'Cancelled', cancelled_by = $3, cancelled_at = now(), cancel_reason = $4
          WHERE club_id = $1 AND payout_id = $2`,
        [db.clubId, payoutId, cancelledBy, reason]
    );
}

module.exports = {
    lockClub, lastApprovedDistribution, existingForYearEnd, openDistribution,
    periodMemberTotals, periodFinancialTotals,
    getDistribution, listDistributions, insertDistribution,
    insertMemberPayout, listMemberPayouts,
    markApproved, markCancelled, markMemberPayoutApproved, markMemberPayoutCancelled
};