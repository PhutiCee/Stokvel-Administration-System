"use strict";

/**
 * Authentication repository.
 *
 * All SQL for authentication lives here. The service above it contains the
 * rules and knows no SQL; this file contains the SQL and knows no rules. That
 * separation is what makes the service testable with a stub.
 *
 * These queries legitimately bypass the club-scope guard in pool.forClub(),
 * because they run BEFORE a club context exists — that is the point of them.
 * They are the small, explicitly listed exception referred to in pool.js.
 */

const { pool } = require("../../db/pool");

/**
 * Phone numbers are stored as digits only so that "082 441 7788",
 * "0824417788", "+27 82 441 7788" and "27824417788" all reach the same
 * account. A member typing their own number from memory should not be turned
 * away over a space.
 */
function normalisePhone(input) {
    if (!input) return null;
    let digits = String(input).replace(/\D/g, "");
    if (digits.startsWith("0027")) digits = digits.slice(4);
    else if (digits.startsWith("27") && digits.length === 11) digits = digits.slice(2);
    else if (digits.startsWith("0")) digits = digits.slice(1);
    return digits ? `0${digits}` : null;
}

/**
 * REQ-1: the identifier may be a phone number or an email address. Members use
 * the phone; officers who registered an email may use either.
 */
async function findByIdentifier(identifier) {
    const raw = String(identifier || "").trim();
    if (!raw) return null;

    const phone = normalisePhone(raw);
    const email = raw.includes("@") ? raw.toLowerCase() : null;

    const { rows } = await pool.query(
        `SELECT user_id, phone, email, full_name, password_hash,
                is_platform_admin, failed_attempts, locked_until
           FROM user_account
          WHERE ($1::text IS NOT NULL AND phone = $1)
             OR ($2::text IS NOT NULL AND email = $2)
          LIMIT 1`,
        [phone, email]
    );
    return rows[0] || null;
}

async function findById(userId) {
    const { rows } = await pool.query(
        `SELECT user_id, phone, email, full_name, is_platform_admin, last_login_at
           FROM user_account WHERE user_id = $1`,
        [userId]
    );
    return rows[0] || null;
}

/** REQ-6: count a failure, and lock once the threshold is reached. */
async function recordFailedAttempt(userId, maxAttempts, lockoutMinutes) {
    const { rows } = await pool.query(
        `UPDATE user_account
            SET failed_attempts = failed_attempts + 1,
                locked_until = CASE
                    WHEN failed_attempts + 1 >= $2
                    THEN now() + ($3 || ' minutes')::interval
                    ELSE locked_until
                END,
                updated_at = now()
          WHERE user_id = $1
      RETURNING failed_attempts, locked_until`,
        [userId, maxAttempts, String(lockoutMinutes)]
    );
    return rows[0];
}

/** A successful sign-in clears the counter. */
async function clearFailedAttempts(userId) {
    await pool.query(
        `UPDATE user_account
            SET failed_attempts = 0, locked_until = NULL,
                last_login_at = now(), updated_at = now()
          WHERE user_id = $1`,
        [userId]
    );
}

/** REQ-4: establishSession(). */
async function createSession({ userId, tokenHash, expiresAt, ipAddress, userAgent }) {
    const { rows } = await pool.query(
        `INSERT INTO session (user_id, token_hash, expires_at, ip_address, user_agent)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING session_id, issued_at, expires_at`,
        [userId, tokenHash, expiresAt, ipAddress, userAgent]
    );
    return rows[0];
}

/**
 * REQ-5: terminateSession(). The row is marked terminated rather than deleted,
 * so that the audit trail still resolves the session id that appears against
 * earlier actions.
 */
async function terminateSession(sessionId) {
    const { rows } = await pool.query(
        `UPDATE session SET terminated_at = now()
          WHERE session_id = $1 AND terminated_at IS NULL
          RETURNING session_id`,
        [sessionId]
    );
    return rows[0] || null;
}

/** Sign-out everywhere. Used when a password changes. */
async function terminateAllSessionsForUser(userId) {
    const { rowCount } = await pool.query(
        `UPDATE session SET terminated_at = now()
          WHERE user_id = $1 AND terminated_at IS NULL`,
        [userId]
    );
    return rowCount;
}

/**
 * REQ-15, REQ-16: listClubMemberships().
 *
 * The one query in the system that deliberately spans clubs, because that is
 * precisely what it is for: showing one person every club they belong to. It
 * is scoped by user_id instead, and returns nothing about clubs the user is
 * not a member of.
 *
 * The outstanding figure lets the club selector show which club actually needs
 * this person's attention, rather than an undifferentiated list of names.
 */
async function listMemberships(userId) {
    const { rows } = await pool.query(
        `SELECT c.club_id,
                c.name,
                c.short_name,
                c.club_type,
                c.status,
                c.town,
                m.member_id,
                m.role,
                m.standing,
                m.join_date,
                m.queue_position,
                (SELECT count(*) FROM member m2
                  WHERE m2.club_id = c.club_id
                    AND m2.standing NOT IN ('Exited', 'Expelled')) AS member_count,
                COALESCE((
                    SELECT sum(ct.expected_amount - ct.captured_amount)
                      FROM contribution ct
                      JOIN cycle cy ON cy.cycle_id = ct.cycle_id
                     WHERE ct.club_id = c.club_id
                       AND ct.member_id = m.member_id
                       AND ct.captured_amount < ct.expected_amount
                ), 0) AS own_outstanding
           FROM member m
           JOIN club c ON c.club_id = m.club_id
          WHERE m.user_id = $1
            AND m.standing <> 'Exited'
          ORDER BY c.name`,
        [userId]
    );
    return rows;
}

/**
 * REQ-17: switchClubContext().
 *
 * Confirms membership BEFORE writing the club onto the session. This is the
 * single gate through which club context is set; if it lets something through,
 * the tenancy filter downstream is working on a false premise.
 */
async function setActiveClub(sessionId, userId, clubId) {
    const { rows } = await pool.query(
        `UPDATE session s
            SET active_club_id = $3
          WHERE s.session_id = $1
            AND s.terminated_at IS NULL
            AND EXISTS (
                SELECT 1 FROM member m
                 WHERE m.user_id = $2
                   AND m.club_id = $3
                   AND m.standing <> 'Exited'
            )
      RETURNING s.session_id, s.active_club_id`,
        [sessionId, userId, clubId]
    );
    return rows[0] || null;
}

async function clearActiveClub(sessionId) {
    await pool.query(
        "UPDATE session SET active_club_id = NULL WHERE session_id = $1",
        [sessionId]
    );
}

/**
 * Housekeeping: mark expired sessions terminated. Called on an interval from
 * index.js. Not strictly required — resolveActor() already refuses an expired
 * session — but it keeps the table honest and makes "who was signed in when"
 * answerable from the data.
 */
async function sweepExpiredSessions() {
    const { rowCount } = await pool.query(
        `UPDATE session SET terminated_at = now()
          WHERE terminated_at IS NULL AND expires_at <= now()`
    );
    return rowCount;
}

module.exports = {
    normalisePhone,
    findByIdentifier,
    findById,
    recordFailedAttempt,
    clearFailedAttempts,
    createSession,
    terminateSession,
    terminateAllSessionsForUser,
    listMemberships,
    setActiveClub,
    clearActiveClub,
    sweepExpiredSessions
};