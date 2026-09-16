"use strict";

/**
 * Membership repository.
 *
 * Every statement here is club-scoped through req.db, so the tenancy guard in
 * pool.js applies. The two exceptions are marked and both go through the shared
 * pool deliberately:
 *
 *   findAccountByIdOrPhone  — searches user_account, which is not club-scoped
 *                             (REQ-39: one person, many clubs)
 *   isActiveMemberElsewhere — answers a question about other clubs on purpose
 */

const { pool } = require("../../db/pool");

/** REQ-16: the register, as the Secretary sees it. */
async function listMembers(db, { includeExited = false } = {}) {
    return db.many(
        `SELECT m.member_id,
                m.role,
                m.standing,
                m.join_date,
                m.exit_date,
                m.queue_position,
                m.catch_up_amount,
                u.user_id,
                u.full_name,
                u.phone,
                u.email,
                u.id_number,
                (SELECT count(*) FROM dependant d
                  WHERE d.member_id = m.member_id
                    AND d.club_id = m.club_id
                    AND d.removed_at IS NULL) AS dependant_count,
                COALESCE((
                    SELECT sum(c.expected_amount - c.captured_amount)
                      FROM contribution c
                     WHERE c.member_id = m.member_id
                       AND c.club_id = m.club_id
                       AND c.captured_amount < c.expected_amount
                ), 0) AS outstanding
           FROM member m
           JOIN user_account u ON u.user_id = m.user_id
          WHERE m.club_id = $1
            ${includeExited ? "" : "AND m.standing <> 'Exited'"}
          ORDER BY
            CASE m.role
                WHEN 'Chairperson' THEN 1
                WHEN 'Treasurer'   THEN 2
                WHEN 'Secretary'   THEN 3
                ELSE 4
            END,
            u.full_name`,
        [db.clubId]
    );
}

async function getMember(db, memberId) {
    return db.one(
        `SELECT m.*, u.full_name, u.phone, u.email, u.id_number,
                u.postal_address, u.last_login_at
           FROM member m
           JOIN user_account u ON u.user_id = m.user_id
          WHERE m.club_id = $1 AND m.member_id = $2`,
        [db.clubId, memberId]
    );
}

/**
 * REQ-39: the same person may belong to several clubs on one account, so before
 * creating an account we look for an existing one. Not club-scoped, by design.
 */
async function findAccountByIdOrPhone(idNumber, phone, client = pool) {
    const { rows } = await client.query(
        `SELECT user_id, full_name, phone, email, id_number, postal_address
           FROM user_account
          WHERE ($1::text IS NOT NULL AND id_number = $1)
             OR ($2::text IS NOT NULL AND phone = $2)
          LIMIT 1`,
        [idNumber || null, phone || null]
    );
    return rows[0] || null;
}

/**
 * REQ-38: reject a registration whose identity number is already an ACTIVE
 * member of THIS club. Exited members do not block re-registration — a person
 * who left and came back is a normal thing in a stokvel.
 */
async function isActiveMemberOfClub(clubId, userId, client = pool) {
    const { rows } = await client.query(
        `SELECT member_id, standing FROM member
          WHERE club_id = $1 AND user_id = $2 AND standing <> 'Exited'`,
        [clubId, userId]
    );
    return rows[0] || null;
}

async function createAccount(client, { fullName, idNumber, phone, email, postalAddress, passwordHash }) {
    const { rows } = await client.query(
        `INSERT INTO user_account
             (full_name, id_number, phone, email, postal_address, password_hash)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING user_id, full_name, phone, email`,
        [fullName, idNumber || null, phone, email || null, postalAddress || null, passwordHash]
    );
    return rows[0];
}

async function createMembership(db, { userId, role, joinDate, queuePosition, catchUpAmount, nextOfKin, registeredBy }) {
    return db.one(
        `INSERT INTO member
             (club_id, user_id, role, join_date, queue_position,
              catch_up_amount, next_of_kin, registered_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
         RETURNING *`,
        [db.clubId, userId, role, joinDate, queuePosition,
         catchUpAmount, nextOfKin ? JSON.stringify(nextOfKin) : null, registeredBy]
    );
}

/** REQ-42: a member joining a rotating club goes to the END of the queue. */
async function nextQueuePosition(db) {
    const row = await db.one(
        `SELECT COALESCE(max(queue_position), 0) + 1 AS next
           FROM member
          WHERE club_id = $1 AND queue_position IS NOT NULL AND standing <> 'Exited'`,
        [db.clubId]
    );
    return Number(row.next);
}

async function updateRole(db, memberId, role) {
    return db.one(
        `UPDATE member SET role = $3, updated_at = now()
          WHERE club_id = $1 AND member_id = $2
          RETURNING member_id, role`,
        [db.clubId, memberId, role]
    );
}

/** REQ-49: how many members currently hold a given officer role. */
async function countHoldersOfRole(db, role, excludeMemberId = null) {
    const row = await db.one(
        `SELECT count(*)::int AS holders
           FROM member
          WHERE club_id = $1
            AND role = $2
            AND standing <> 'Exited'
            AND ($3::uuid IS NULL OR member_id <> $3)`,
        [db.clubId, role, excludeMemberId]
    );
    return row.holders;
}

async function updateAccountContact(client, userId, { phone, email, postalAddress }) {
    const { rows } = await client.query(
        `UPDATE user_account
            SET phone = COALESCE($2, phone),
                email = COALESCE($3, email),
                postal_address = COALESCE($4, postal_address),
                updated_at = now()
          WHERE user_id = $1
          RETURNING user_id`,
        [userId, phone || null, email || null, postalAddress || null]
    );
    return rows[0] || null;
}

async function updateNextOfKin(db, memberId, nextOfKin) {
    return db.one(
        `UPDATE member SET next_of_kin = $3, updated_at = now()
          WHERE club_id = $1 AND member_id = $2
          RETURNING member_id`,
        [db.clubId, memberId, JSON.stringify(nextOfKin)]
    );
}

/** The constitution in force today. Needed for the catch-up figure (REQ-41). */
async function currentConstitution(db) {
    return db.one(
        `SELECT * FROM constitution
          WHERE club_id = $1 AND effective_date <= CURRENT_DATE
          ORDER BY effective_date DESC, version DESC
          LIMIT 1`,
        [db.clubId]
    );
}

async function openCycle(db) {
    return db.one(
        `SELECT cycle_id, sequence_number, start_date, due_date
           FROM cycle
          WHERE club_id = $1 AND status = 'Open'
          LIMIT 1`,
        [db.clubId]
    );
}

async function clubType(db) {
    const row = await db.one(
        "SELECT club_type, name FROM club WHERE club_id = $1",
        [db.clubId]
    );
    return row;
}

module.exports = {
    listMembers,
    getMember,
    findAccountByIdOrPhone,
    isActiveMemberOfClub,
    createAccount,
    createMembership,
    nextQueuePosition,
    updateRole,
    countHoldersOfRole,
    updateAccountContact,
    updateNextOfKin,
    currentConstitution,
    openCycle,
    clubType
};