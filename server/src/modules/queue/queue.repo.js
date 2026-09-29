"use strict";

/**
 * Payout queue repo. SQL only, no rules.
 *
 * The order of the queue lives in member.queue_position, where the register and
 * the seed already keep it. There is no separate queue table: a second copy of
 * the order could disagree with the first. What this module adds are the two
 * things that are not positions: exchange requests and the Chairperson's
 * rulings on a member in arrears.
 *
 * Dates are selected as text. See lib/dates.js.
 */

/** Locks the club row. Every payout and queue change starts here, so they run one at a time. */
async function lockClub(db) {
    return db.one(
        `SELECT club_id, club_type FROM club WHERE club_id = $1 FOR UPDATE`,
        [db.clubId]
    );
}

/** Everyone who holds a place in the queue, in queue order. */
async function listQueueRows(db) {
    return db.many(
        `SELECT m.member_id, m.queue_position, m.standing, m.role,
                m.join_date::text  AS join_date,
                m.created_at       AS registered_at,
                u.user_id, u.full_name
           FROM member m
           JOIN user_account u ON u.user_id = m.user_id
          WHERE m.club_id = $1
            AND m.queue_position IS NOT NULL
            AND m.standing <> 'Exited'
          ORDER BY m.queue_position ASC`,
        [db.clubId]
    );
}

/** Members of a rotating club who are not yet in the queue, for a draw. */
async function listDrawCandidates(db) {
    return db.many(
        `SELECT m.member_id, m.standing,
                m.join_date::text AS join_date,
                m.created_at      AS registered_at
           FROM member m
          WHERE m.club_id = $1
            AND m.standing NOT IN ('Exited', 'Expelled')
          ORDER BY m.created_at ASC`,
        [db.clubId]
    );
}

async function getMemberRow(db, memberId) {
    return db.one(
        `SELECT m.member_id, m.user_id, m.queue_position, m.standing, m.role,
                u.full_name
           FROM member m
           JOIN user_account u ON u.user_id = m.user_id
          WHERE m.club_id = $1 AND m.member_id = $2`,
        [db.clubId, memberId]
    );
}

/**
 * Writes a whole queue in one statement. The uniqueness constraint on
 * (club_id, queue_position) is deferred, so the rows can pass through
 * intermediate states inside the transaction and are checked once, at commit.
 */
async function setPositions(db, entries) {
    if (!entries.length) return;
    await db.query(
        `UPDATE member m
            SET queue_position = v.position, updated_at = now()
           FROM (SELECT unnest($2::uuid[]) AS member_id,
                        unnest($3::int[])  AS position) v
          WHERE m.club_id = $1 AND m.member_id = v.member_id`,
        [db.clubId, entries.map((e) => e.memberId), entries.map((e) => e.position)]
    );
}

async function clearPosition(db, memberId) {
    await db.query(
        `UPDATE member SET queue_position = NULL, updated_at = now()
          WHERE club_id = $1 AND member_id = $2`,
        [db.clubId, memberId]
    );
}

/**
 * The earliest cycle with no live rotation payout against it. Cancelled
 * payouts do not count, so cancelling frees the cycle.
 */
async function earliestUnpaidCycle(db) {
    return db.one(
        `SELECT cy.cycle_id, cy.sequence_number, cy.status,
                cy.start_date::text AS start_date,
                cy.due_date::text   AS due_date
           FROM cycle cy
          WHERE cy.club_id = $1
            AND NOT EXISTS (
                SELECT 1 FROM payout p
                 WHERE p.club_id = $1
                   AND p.cycle_id = cy.cycle_id
                   AND p.payout_type = 'Rotation'
                   AND p.status <> 'Cancelled')
          ORDER BY cy.sequence_number ASC
          LIMIT 1`,
        [db.clubId]
    );
}

/** The most recent cycle, used to date the queue when every cycle has been paid. */
async function latestCycle(db) {
    return db.one(
        `SELECT cycle_id, sequence_number, due_date::text AS due_date
           FROM cycle WHERE club_id = $1
          ORDER BY sequence_number DESC LIMIT 1`,
        [db.clubId]
    );
}

/** Takes every position in the club away except from the members named. */
async function clearPositionsExcept(db, keepMemberIds) {
    await db.query(
        `UPDATE member SET queue_position = NULL, updated_at = now()
          WHERE club_id = $1 AND queue_position IS NOT NULL
            AND NOT (member_id = ANY($2::uuid[]))`,
        [db.clubId, keepMemberIds]
    );
}

async function hasOpenRotationPayout(db) {
    const row = await db.one(
        `SELECT 1 AS found FROM payout
          WHERE club_id = $1 AND payout_type = 'Rotation' AND status = 'Initiated'`,
        [db.clubId]
    );
    return Boolean(row);
}

/** True once any money has been paid out, whether or not a payout row exists for it. */
async function hasPaidAnyone(db) {
    const row = await db.one(
        `SELECT (EXISTS (SELECT 1 FROM ledger_entry
                          WHERE club_id = $1 AND entry_type = 'Payout')
              OR EXISTS (SELECT 1 FROM payout
                          WHERE club_id = $1 AND status <> 'Cancelled')) AS paid`,
        [db.clubId]
    );
    return row.paid;
}

// --- arrears rulings (REQ-77) ----------------------------------------------

async function insertArrearsDecision(db, { memberId, decision, standingAtDecision, reason, decidedBy }) {
    return db.one(
        `INSERT INTO queue_arrears_decision
             (club_id, member_id, decision, standing_at_decision, reason, decided_by)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING decision_id, decision, reason, decided_at`,
        [db.clubId, memberId, decision, standingAtDecision, reason, decidedBy]
    );
}

/**
 * A ruling to pay this member notwithstanding arrears that has not yet backed a
 * payout, and that no later deferral has overtaken.
 */
async function usablePayRuling(db, memberId) {
    return db.one(
        `SELECT d.decision_id, d.reason, d.decided_at, d.decided_by
           FROM queue_arrears_decision d
          WHERE d.club_id = $1
            AND d.member_id = $2
            AND d.decision = 'Paid notwithstanding arrears'
            AND NOT EXISTS (
                SELECT 1 FROM payout p
                 WHERE p.club_id = $1
                   AND p.arrears_decision_id = d.decision_id
                   AND p.status <> 'Cancelled')
            AND d.decided_at > COALESCE((
                SELECT max(x.decided_at) FROM queue_arrears_decision x
                 WHERE x.club_id = $1 AND x.member_id = $2 AND x.decision = 'Deferred'
            ), '-infinity'::timestamptz)
          ORDER BY d.decided_at DESC
          LIMIT 1`,
        [db.clubId, memberId]
    );
}

// --- exchanges of position (REQ-74, REQ-75) ---------------------------------

const SWAP_COLUMNS = `
    s.swap_id, s.status,
    s.requester_member_id, s.counterparty_member_id,
    s.requested_at, s.requested_by,
    s.requester_position_at_request, s.counterparty_position_at_request,
    s.consent_given, s.consent_by, s.consent_at,
    s.decided_by, s.decided_at, s.decision_reason,
    s.requester_position_after, s.counterparty_position_after,
    ru.full_name AS requester_name, cu.full_name AS counterparty_name`;

const SWAP_JOINS = `
    FROM queue_swap s
    JOIN member rm ON rm.member_id = s.requester_member_id
    JOIN user_account ru ON ru.user_id = rm.user_id
    JOIN member cm ON cm.member_id = s.counterparty_member_id
    JOIN user_account cu ON cu.user_id = cm.user_id`;

async function insertSwap(db, { requesterMemberId, counterpartyMemberId, requestedBy, requesterPosition, counterpartyPosition }) {
    return db.one(
        `INSERT INTO queue_swap
             (club_id, requester_member_id, counterparty_member_id, requested_by,
              requester_position_at_request, counterparty_position_at_request)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING swap_id`,
        [db.clubId, requesterMemberId, counterpartyMemberId, requestedBy, requesterPosition, counterpartyPosition]
    );
}

async function getSwap(db, swapId, { forUpdate = false } = {}) {
    // FOR UPDATE cannot be combined with the joins' outer columns cleanly, so the
    // row is locked first and read with names second.
    if (forUpdate) {
        await db.query(
            `SELECT swap_id FROM queue_swap WHERE club_id = $1 AND swap_id = $2 FOR UPDATE`,
            [db.clubId, swapId]
        );
    }
    return db.one(
        `SELECT ${SWAP_COLUMNS} ${SWAP_JOINS}
          WHERE s.club_id = $1 AND s.swap_id = $2`,
        [db.clubId, swapId]
    );
}

async function listSwaps(db, { openOnly = false, limit = 50 } = {}) {
    return db.many(
        `SELECT ${SWAP_COLUMNS} ${SWAP_JOINS}
          WHERE s.club_id = $1
            ${openOnly ? "AND s.status IN ('Pending consent', 'Pending approval')" : ""}
          ORDER BY s.requested_at DESC
          LIMIT ${Number(limit)}`,
        [db.clubId]
    );
}

/** Open exchanges in which either of these members is a party, in either role. */
async function openSwapsTouching(db, memberIds) {
    return db.many(
        `SELECT s.swap_id, s.requester_member_id, s.counterparty_member_id
           FROM queue_swap s
          WHERE s.club_id = $1
            AND s.status IN ('Pending consent', 'Pending approval')
            AND (s.requester_member_id = ANY($2::uuid[])
              OR s.counterparty_member_id = ANY($2::uuid[]))`,
        [db.clubId, memberIds]
    );
}

async function recordConsent(db, swapId, { consent, consentBy }) {
    await db.query(
        `UPDATE queue_swap
            SET consent_given = $3, consent_by = $4, consent_at = now(),
                status = $5::queue_swap_status
          WHERE club_id = $1 AND swap_id = $2`,
        [db.clubId, swapId, consent, consentBy, consent ? "Pending approval" : "Declined"]
    );
}

async function recordDecision(db, swapId, { status, decidedBy, reason, requesterAfter = null, counterpartyAfter = null }) {
    await db.query(
        `UPDATE queue_swap
            SET status = $3::queue_swap_status, decided_by = $4, decided_at = now(),
                decision_reason = $5,
                requester_position_after = $6, counterparty_position_after = $7
          WHERE club_id = $1 AND swap_id = $2`,
        [db.clubId, swapId, status, decidedBy, reason, requesterAfter, counterpartyAfter]
    );
}

async function cancelSwap(db, swapId, { cancelledBy }) {
    await db.query(
        `UPDATE queue_swap
            SET status = 'Cancelled', decided_by = $3, decided_at = now(),
                decision_reason = 'Withdrawn by the member who asked for it'
          WHERE club_id = $1 AND swap_id = $2`,
        [db.clubId, swapId, cancelledBy]
    );
}

module.exports = {
    lockClub, listQueueRows, listDrawCandidates, getMemberRow,
    setPositions, clearPosition,
    earliestUnpaidCycle, latestCycle, clearPositionsExcept, hasOpenRotationPayout, hasPaidAnyone,
    insertArrearsDecision, usablePayRuling,
    insertSwap, getSwap, listSwaps, openSwapsTouching,
    recordConsent, recordDecision, cancelSwap
};