"use strict";

/**
 * Session authentication. REQ-4, REQ-5, REQ-8, REQ-10.
 *
 * Resolves the session cookie into req.actor:
 *
 *     req.actor = {
 *         sessionId, userId, fullName, phone, isPlatformAdmin,
 *         clubId,        // active club context, or null
 *         clubName,
 *         memberId,      // this user's membership of that club
 *         role           // 'Treasurer' | ... | 'PlatformAdmin' | null
 *     }
 *
 * Two things worth noticing.
 *
 * First, the ROLE IS LOOKED UP FRESH ON EVERY REQUEST, joined from the member
 * row for the active club. It is not baked into the token at sign-in. A
 * chairperson demoted at this morning's meeting loses the approval authority on
 * her next click, not when her session happens to expire (REQ-10).
 *
 * Second, the ACTIVE CLUB LIVES ON THE SESSION ROW, in the database. The client
 * cannot tell the server which club it is acting in. That is what makes the
 * tenancy filter something other than a suggestion (REQ-13).
 */

const crypto = require("crypto");
const { pool } = require("../db/pool");
const { env } = require("../config/env");
const { Unauthorised } = require("../lib/errors");

const hashToken = (token) => crypto.createHash("sha256").update(token).digest("hex");

/** A fresh opaque token. 32 bytes of CSPRNG output, never derived from user data. */
function mintToken() {
    return crypto.randomBytes(32).toString("base64url");
}

/**
 * Reads the session, verifies it is live, slides the idle window forward, and
 * loads the actor. Returns null when there is no valid session.
 */
async function resolveActor(token) {
    if (!token) return null;

    const { rows } = await pool.query(
        `SELECT s.session_id,
                s.user_id,
                s.active_club_id,
                s.expires_at,
                u.full_name,
                u.phone,
                u.is_platform_admin,
                c.name        AS club_name,
                c.club_type   AS club_type,
                c.status      AS club_status,
                m.member_id,
                m.role        AS member_role,
                m.standing    AS member_standing
           FROM session s
           JOIN user_account u ON u.user_id = s.user_id
           LEFT JOIN club   c ON c.club_id = s.active_club_id
           LEFT JOIN member m ON m.club_id = s.active_club_id
                             AND m.user_id = s.user_id
          WHERE s.token_hash = $1
            AND s.terminated_at IS NULL
            AND s.expires_at > now()`,
        [hashToken(token)]
    );

    const row = rows[0];
    if (!row) return null;

    // REQ-4: thirty minutes of INACTIVITY, so the window slides on every
    // authenticated request rather than counting down from sign-in.
    const nextExpiry = new Date(Date.now() + env.SESSION_IDLE_MINUTES * 60_000);
    await pool.query(
        "UPDATE session SET expires_at = $1 WHERE session_id = $2",
        [nextExpiry, row.session_id]
    );

    return {
        sessionId: row.session_id,
        userId: row.user_id,
        fullName: row.full_name,
        phone: row.phone,
        isPlatformAdmin: row.is_platform_admin,

        clubId: row.active_club_id,
        clubName: row.club_name,
        clubType: row.club_type,
        clubStatus: row.club_status,

        memberId: row.member_id,
        standing: row.member_standing,

        // A platform administrator has no membership anywhere, so the role
        // comes from the account rather than from a member row.
        role: row.is_platform_admin ? "PlatformAdmin" : (row.member_role || null),

        expiresAt: nextExpiry
    };
}

/** Populates req.actor when a session exists. Never refuses. */
async function loadActor(req, res, next) {
    try {
        const token = req.cookies?.[env.SESSION_COOKIE_NAME];
        req.actor = await resolveActor(token);
        next();
    } catch (err) {
        next(err);
    }
}

/** Refuses the request unless a session exists. */
function requireSession(req, res, next) {
    if (!req.actor) {
        return next(new Unauthorised("Your session has ended. Please sign in again."));
    }
    next();
}

module.exports = { loadActor, requireSession, resolveActor, mintToken, hashToken };