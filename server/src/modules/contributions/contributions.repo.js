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

// REQ-33: amendments govern cycles commencing strictly AFTER their effective date.
async function constitutionForStart(db, date) {
    return db.one(
        `SELECT * FROM constitution WHERE club_id=$1
        AND (effective_date<$2::date OR (version=1 AND effective_date<=$2::date))
        ORDER BY version DESC LIMIT 1`,
        [db.clubId, date]
    );
}
async function constitutionForCycle(db, cycleId) {
    return db.one(
        `SELECT k.* FROM constitution k JOIN cycle c
        ON c.club_id=k.club_id AND c.constitution_id=k.constitution_id
        WHERE c.club_id=$1 AND c.cycle_id=$2`,
        [db.clubId, cycleId]
    );
}
async function lockClub(db) {
    return db.one("SELECT club_id FROM club WHERE club_id=$1 FOR UPDATE", [db.clubId]);
}

// --- cycles ----------------------------------------------------------------

async function openCycleFor(db) {
    return db.one(
        `SELECT *, start_date::text, due_date::text FROM cycle WHERE club_id = $1 AND status = 'Open' LIMIT 1`,
        [db.clubId]
    );
}

async function getCycle(db, cycleId) {
    return db.one(
        "SELECT *, start_date::text, due_date::text FROM cycle WHERE club_id = $1 AND cycle_id = $2",
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
         RETURNING *, start_date::text, due_date::text`,
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
        `SELECT c.*, c.start_date::text, c.due_date::text,
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
        `SELECT ct.*, u.full_name, c.status AS cycle_status, c.due_date::text, c.start_date::text,
                c.sequence_number, m.standing
           FROM contribution ct
           JOIN cycle c        ON c.cycle_id = ct.cycle_id AND c.club_id = ct.club_id
           JOIN member m       ON m.member_id = ct.member_id AND m.club_id = ct.club_id
           JOIN user_account u ON u.user_id = m.user_id
          WHERE ct.club_id = $1 AND ct.contribution_id = $2`,
        [db.clubId, contributionId]
    );
}

async function applyCapture(
    tx,
    contributionId,
    { capturedAmount, status, receiptDate, method, reference, capturedBy }
) {
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
        [
            tx.clubId,
            contributionId,
            capturedAmount,
            status,
            receiptDate,
            method,
            reference,
            capturedBy
        ]
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
                c.sequence_number, c.due_date::text, c.start_date::text, c.cycle_id
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

// --- waiver (REQ-63, BR-13) -------------------------------------------------

// Paged register; an ordinary member is always restricted to their own rows.
async function listPenalties(db, { memberId, status, offset, limit }) {
    return db.many(
        `SELECT p.*, u.full_name, c.sequence_number,
        w.full_name AS waived_by_name
        FROM penalty p
        JOIN member m ON m.club_id=p.club_id AND m.member_id=p.member_id
        JOIN user_account u ON u.user_id=m.user_id
        LEFT JOIN cycle c ON c.club_id=p.club_id AND c.cycle_id=p.cycle_id
        LEFT JOIN user_account w ON w.user_id=p.waived_by
        WHERE p.club_id=$1 AND ($2::uuid IS NULL OR p.member_id=$2)
          AND ($3='all' OR ($3='waived' AND p.waived_at IS NOT NULL)
            OR ($3='outstanding' AND p.waived_at IS NULL AND p.settled_amount<p.amount)
            OR ($3='settled' AND p.waived_at IS NULL AND p.settled_amount>=p.amount))
        ORDER BY p.levied_at DESC, p.penalty_id DESC LIMIT $4 OFFSET $5`,
        [db.clubId, memberId, status, limit, offset]
    );
}

async function getPenalty(db, penaltyId) {
    return db.one(
        `SELECT p.*, u.full_name, c.sequence_number
           FROM penalty p
           JOIN member m ON m.member_id = p.member_id
           JOIN user_account u ON u.user_id = m.user_id
           LEFT JOIN cycle c ON c.cycle_id = p.cycle_id
          WHERE p.club_id = $1 AND p.penalty_id = $2`,
        [db.clubId, penaltyId]
    );
}

/** The entry posted when this penalty was levied. Never the reversal itself. */
async function getPenaltyLedgerEntry(db, penaltyId) {
    return db.one(
        `SELECT entry_id, amount FROM ledger_entry
          WHERE club_id = $1 AND penalty_id = $2 AND entry_type = 'Penalty' AND reverses_id IS NULL`,
        [db.clubId, penaltyId]
    );
}

async function markWaived(db, penaltyId, { waivedBy, reason }) {
    await db.query(
        `UPDATE penalty SET waived_at = now(), waived_by = $3, waiver_reason = $4
          WHERE club_id = $1 AND penalty_id = $2`,
        [db.clubId, penaltyId, waivedBy, reason]
    );
}

// --- proof of payment (REQ-51 to REQ-53) ------------------------------------

/**
 * Replaces whatever was there before — a Treasurer may upload a clearer copy.
 * Called by the service inside its own transaction, the same as every other
 * multi-statement repo function in this file.
 *
 * contribution.proof_url (migration 005, "SDD 5.3: object storage reference")
 * predates this table and was written for a design that keeps the file in
 * external object storage and only a URL here. Without such a service
 * configured, the file is instead stored in proof_of_payment, and proof_url is
 * kept in step anyway, pointing at this API's own download route, so the
 * column still means what its comment says: where to fetch the file from.
 */
async function upsertProof(
    tx,
    contributionId,
    { fileData, mimeType, originalFilename, fileSize, uploadedBy }
) {
    const saved = await tx.one(
        `INSERT INTO proof_of_payment
             (club_id, contribution_id, file_data, mime_type, original_filename, file_size, uploaded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (contribution_id) DO UPDATE SET
             file_data = EXCLUDED.file_data, mime_type = EXCLUDED.mime_type,
             original_filename = EXCLUDED.original_filename, file_size = EXCLUDED.file_size,
             uploaded_by = EXCLUDED.uploaded_by, uploaded_at = now()
         RETURNING proof_id, mime_type, original_filename, file_size, uploaded_at`,
        [tx.clubId, contributionId, fileData, mimeType, originalFilename, fileSize, uploadedBy]
    );
    await tx.query(
        `UPDATE contribution SET proof_url = $3 WHERE club_id = $1 AND contribution_id = $2`,
        [tx.clubId, contributionId, `/api/contributions/${contributionId}/proof/file`]
    );
    return saved;
}

/** Metadata only — for showing that a proof exists, without pulling the bytes. */
async function getProofMeta(db, contributionId) {
    return db.one(
        `SELECT proof_id, mime_type, original_filename, file_size, uploaded_at, uploaded_by
           FROM proof_of_payment WHERE club_id = $1 AND contribution_id = $2`,
        [db.clubId, contributionId]
    );
}

/** The bytes themselves, for download. */
async function getProofFile(db, contributionId) {
    return db.one(
        `SELECT file_data, mime_type, original_filename
           FROM proof_of_payment WHERE club_id = $1 AND contribution_id = $2`,
        [db.clubId, contributionId]
    );
}

/** Called by the service inside its own transaction. */
async function deleteProof(tx, contributionId) {
    await tx.query(`DELETE FROM proof_of_payment WHERE club_id = $1 AND contribution_id = $2`, [
        tx.clubId,
        contributionId
    ]);
    await tx.query(
        `UPDATE contribution SET proof_url = NULL WHERE club_id = $1 AND contribution_id = $2`,
        [tx.clubId, contributionId]
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
    constitutionForStart,
    constitutionForCycle,
    lockClub,
    openCycleFor,
    getCycle,
    nextSequenceNumber,
    createCycle,
    membersForNewCycle,
    listCycles,
    insertExpected,
    listForCycle,
    getContribution,
    applyCapture,
    setStatus,
    priorOutstanding,
    unsettledPenalties,
    settlePenalty,
    levyPenalty,
    listPenalties,
    getPenalty,
    getPenaltyLedgerEntry,
    markWaived,
    upsertProof,
    getProofMeta,
    getProofFile,
    deleteProof,
    addCredit,
    getMemberCredit
};
