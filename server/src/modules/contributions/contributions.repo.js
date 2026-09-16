"use strict";

/**
 * Cycles and contributions repository.
 *
 * All SQL for Use Case 2. Every statement is club-scoped through req.db, or
 * through a club-scoped wrapper inside a transaction, so the tenancy guard in
 * pool.js applies to all of it.
 */

const { forClub } = require("../../db/pool");

// --- constitution ----------------------------------------------------------

/** The constitution in force on a date. REQ-30, REQ-50. */
async function constitutionInForceOn(db, date = null) {
    return date
        ? db.one(
            `SELECT * FROM constitution
              WHERE club_id = $1 AND effective_date <= $2
              ORDER BY effective_date DESC, version DESC LIMIT 1`,
            [db.clubId, date]
        )
        : db.one(
            `SELECT * FROM constitution
              WHERE club_id = $1 AND effective_date <= CURRENT_DATE
              ORDER BY effective_date DESC, version DESC LIMIT 1`,
            [db.clubId]
        );
}

// --- cycles ----------------------------------------------------------------

async function openCycleFor(db) {
    return db.one(
        `SELECT * FROM cycle WHERE club_id = $1 AND status = 'Open' LIMIT 1`,
        [db.clubId]
    );
}

async function getCycle(db, cycleId) {
    return db.one(
        "SELECT * FROM cycle WHERE club_id = $1 AND cycle_id = $2",
        [db.clubId, cycleId]
    );
}

async function nextSequenceNumber(db) {
    const row = await db.one(
        `SELECT COALESCE(max(sequence_number), 0) + 1 AS next
           FROM cycle WHERE club_id = $1`,
        [db.clubId]
    );
    return Number(row.next);
}

async function createCycle(tx, { sequenceNumber, startDate, dueDate, openedBy }) {
    return tx.one(
        `INSERT INTO cycle (club_id, sequence_number, start_date, due_date, opened_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING *`,
        [tx.clubId, sequenceNumber, startDate, dueDate, openedBy]
    );
}

/**
 * REQ-50: an expected-contribution record for every member IN GOOD STANDING.
 *
 * Members in arrears, suspended, expelled or exited are excluded, which is what
 * the requirement says. It is worth being clear why: a suspended member is not
 * entitled to contribute to a pool they cannot draw from, and billing them
 * would quietly re-admit them.
 */
async function membersForNewCycle(db) {
    return db.many(
        `SELECT member_id, credit_amount, catch_up_amount
           FROM member
          WHERE club_id = $1 AND standing = 'Good standing'
          ORDER BY member_id`,
        [db.clubId]
    );
}

async function listCycles(db, limit = 24) {
    return db.many(
        `SELECT c.*,
                count(ct.*)::int AS member_count,
                COALESCE(sum(ct.expected_amount), 0) AS expected_total,
                COALESCE(sum(ct.captured_amount), 0) AS captured_total
           FROM cycle c
           LEFT JOIN contribution ct
                  ON ct.cycle_id = c.cycle_id AND ct.club_id = c.club_id
          WHERE c.club_id = $1
          GROUP BY c.cycle_id
          ORDER BY c.sequence_number DESC
          LIMIT $2`,
        [db.clubId, limit]
    );
}

// --- contributions ---------------------------------------------------------

async function insertExpected(tx, { cycleId, memberId, expectedAmount }) {
    return tx.one(
        `INSERT INTO contribution (club_id, cycle_id, member_id, expected_amount)
         VALUES ($1, $2, $3, $4)
         RETURNING contribution_id`,
        [tx.clubId, cycleId, memberId, expectedAmount]
    );
}

async function listForCycle(db, cycleId) {
    return db.many(
        `SELECT ct.*, u.full_name, u.phone, m.standing, m.queue_position
           FROM contribution ct
           JOIN member m       ON m.member_id = ct.member_id AND m.club_id = ct.club_id
           JOIN user_account u ON u.user_id = m.user_id
          WHERE ct.club_id = $1 AND ct.cycle_id = $2
          ORDER BY u.full_name`,
        [db.clubId, cycleId]
    );
}

async function getContribution(db, contributionId) {
    return db.one(
        `SELECT ct.*, u.full_name, c.status AS cycle_status, c.due_date,
                c.sequence_number, m.standing
           FROM contribution ct
           JOIN cycle c        ON c.cycle_id = ct.cycle_id AND c.club_id = ct.club_id
           JOIN member m       ON m.member_id = ct.member_id AND m.club_id = ct.club_id
           JOIN user_account u ON u.user_id = m.user_id
          WHERE ct.club_id = $1 AND ct.contribution_id = $2`,
        [db.clubId, contributionId]
    );
}

async function applyCapture(tx, contributionId, { capturedAmount, status, receiptDate, method, reference, capturedBy }) {
    return tx.one(
        `UPDATE contribution
            SET captured_amount = $3,
                status          = $4,
                receipt_date    = COALESCE($5, receipt_date),
                method          = COALESCE($6, method),
                reference       = COALESCE($7, reference),
                captured_by     = $8,
                captured_at     = now(),
                updated_at      = now()
          WHERE club_id = $1 AND contribution_id = $2
          RETURNING *`,
        [tx.clubId, contributionId, capturedAmount, status, receiptDate, method, reference, capturedBy]
    );
}

async function setStatus(tx, contributionId, status) {
    return tx.one(
        `UPDATE contribution SET status = $3, updated_at = now()
          WHERE club_id = $1 AND contribution_id = $2
          RETURNING contribution_id, status`,
        [tx.clubId, contributionId, status]
    );
}

/** REQ-57: prior outstanding contributions, oldest cycle first. */
async function priorOutstanding(tx, memberId, excludeContributionId) {
    return tx.many(
        `SELECT ct.contribution_id, ct.expected_amount, ct.captured_amount,
                c.sequence_number, c.due_date
           FROM contribution ct
           JOIN cycle c ON c.cycle_id = ct.cycle_id AND c.club_id = ct.club_id
          WHERE ct.club_id = $1
            AND ct.member_id = $2
            AND ct.contribution_id <> $3
            AND ct.captured_amount < ct.expected_amount
          ORDER BY c.sequence_number ASC`,
        [tx.clubId, memberId, excludeContributionId]
    );
}

// --- penalties -------------------------------------------------------------

/** REQ-57: unsettled penalties, oldest first. */
async function unsettledPenalties(tx, memberId) {
    return tx.many(
        `SELECT penalty_id, amount, settled_amount, reason, levied_at
           FROM penalty
          WHERE club_id = $1 AND member_id = $2
            AND waived_at IS NULL
            AND settled_amount < amount
          ORDER BY levied_at ASC`,
        [tx.clubId, memberId]
    );
}

async function settlePenalty(tx, penaltyId, settledAmount) {
    return tx.one(
        `UPDATE penalty SET settled_amount = $3
          WHERE club_id = $1 AND penalty_id = $2
          RETURNING penalty_id, amount, settled_amount`,
        [tx.clubId, penaltyId, settledAmount]
    );
}

/**
 * REQ-56: post the penalty once only for a given member and cycle.
 *
 * ON CONFLICT DO NOTHING against the unique index from migration 009, so two
 * requests resolving the same status simultaneously cannot fine a member twice.
 * Returns null when a penalty already existed.
 */
async function levyPenalty(tx, { memberId, cycleId, amount, reason }) {
    const { rows } = await tx.query(
        `INSERT INTO penalty (club_id, member_id, cycle_id, amount, reason)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (club_id, member_id, cycle_id) WHERE cycle_id IS NOT NULL
         DO NOTHING
         RETURNING penalty_id, amount`,
        [tx.clubId, memberId, cycleId, amount, reason]
    );
    return rows[0] || null;
}

// --- member credit ---------------------------------------------------------

async function addCredit(tx, memberId, creditAmount) {
    return tx.one(
        `UPDATE member SET credit_amount = $3, updated_at = now()
          WHERE club_id = $1 AND member_id = $2
          RETURNING member_id, credit_amount`,
        [tx.clubId, memberId, creditAmount]
    );
}

async function getMemberCredit(tx, memberId) {
    return tx.one(
        "SELECT member_id, credit_amount, standing FROM member WHERE club_id = $1 AND member_id = $2",
        [tx.clubId, memberId]
    );
}

module.exports = {
    forClub,
    constitutionInForceOn,
    openCycleFor, getCycle, nextSequenceNumber, createCycle, membersForNewCycle, listCycles,
    insertExpected, listForCycle, getContribution, applyCapture, setStatus, priorOutstanding,
    unsettledPenalties, settlePenalty, levyPenalty,
    addCredit, getMemberCredit
};