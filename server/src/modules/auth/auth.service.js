"use strict";

/**
 * Authentication service.
 *
 * Implements UserAccount from SRS 4.4.17:
 *
 *     authenticate()          REQ-1, REQ-2, REQ-6      Use Case 1
 *     establishSession()      REQ-4
 *     terminateSession()      REQ-5
 *     listClubMemberships()   REQ-15, REQ-16
 *     switchClubContext()     REQ-17
 *
 * No Express in this file. Everything takes plain arguments and returns plain
 * objects or throws a typed error, so the whole of Use Case 1 can be exercised
 * in a test without an HTTP server (SRS 5.4, Testability).
 */

const repo = require("./auth.repo");
const { env } = require("../../config/env");
const { verifyPassword, wasteTime } = require("../../lib/password");
const { mintToken, hashToken } = require("../../middleware/authenticate");
const { BadRequest, Unauthorised, TooManyAttempts, NotFound } = require("../../lib/errors");

/**
 * REQ-1 requires a message that does not disclose whether the username exists.
 * One constant, used for every failure mode that could otherwise distinguish
 * "no such account" from "wrong password".
 */
const GENERIC_FAILURE = "Those details are not correct. Check your number and password and try again.";

/**
 * authenticate() — SRS 4.4.17, REQ-1, REQ-2, REQ-6.
 *
 * @returns {Promise<{user: object, session: object, token: string}>}
 * @throws  {Unauthorised}     wrong credentials, wrong account, no account
 * @throws  {TooManyAttempts}  account currently locked
 */
async function authenticate({ identifier, password, ipAddress, userAgent, audit }) {
    if (!identifier || !password) {
        throw new BadRequest("Enter your phone number and your password.");
    }

    const account = await repo.findByIdentifier(identifier);

    if (!account) {
        // Spend the same time we would have spent on a real verification, so
        // that response time does not reveal which numbers are registered.
        await wasteTime();
        await audit?.("auth.login", "Failed", {
            detail: `No account for identifier "${identifier}"`,
            userId: null
        });
        throw new Unauthorised(GENERIC_FAILURE);
    }

    // REQ-6: still locked?
    if (account.locked_until && new Date(account.locked_until) > new Date()) {
        const minutes = Math.max(
            1,
            Math.ceil((new Date(account.locked_until) - Date.now()) / 60_000)
        );
        await audit?.("auth.login", "Refused", {
            userId: account.user_id,
            detail: `Account locked, ${minutes} minute(s) remaining`
        });
        throw new TooManyAttempts(
            `This account is locked after five incorrect attempts. Try again in ` +
            `${minutes} minute${minutes === 1 ? "" : "s"}, or ask your club's secretary for help.`
        );
    }

    const ok = await verifyPassword(password, account.password_hash);

    if (!ok) {
        const state = await repo.recordFailedAttempt(
            account.user_id, env.MAX_FAILED_ATTEMPTS, env.LOCKOUT_MINUTES
        );
        const justLocked = state?.locked_until && new Date(state.locked_until) > new Date();

        await audit?.("auth.login", "Failed", {
            userId: account.user_id,
            detail: `Incorrect password. Attempt ${state?.failed_attempts} of ` +
                    `${env.MAX_FAILED_ATTEMPTS}.${justLocked ? " Account now locked." : ""}`
        });

        if (justLocked) {
            // REQ-6 also requires notifying the account holder through their
            // registered contact channel. The notification service arrives with
            // the announcements module; until then the lock itself is recorded
            // and visible in the audit log.
            throw new TooManyAttempts(
                `This account is now locked for ${env.LOCKOUT_MINUTES} minutes after ` +
                `five incorrect attempts.`
            );
        }
        throw new Unauthorised(GENERIC_FAILURE);
    }

    await repo.clearFailedAttempts(account.user_id);

    const session = await establishSession({ userId: account.user_id, ipAddress, userAgent });

    await audit?.("auth.login", "Success", {
        userId: account.user_id,
        detail: `${account.full_name} signed in`
    });

    return {
        user: {
            userId: account.user_id,
            fullName: account.full_name,
            phone: account.phone,
            email: account.email,
            isPlatformAdmin: account.is_platform_admin
        },
        session: { sessionId: session.sessionId, expiresAt: session.expiresAt },
        token: session.token
    };
}

/**
 * establishSession() — REQ-4.
 *
 * The token returned here is the only time the plaintext token exists. The
 * database holds its SHA-256 digest.
 */
async function establishSession({ userId, ipAddress = null, userAgent = null }) {
    const token = mintToken();
    const expiresAt = new Date(Date.now() + env.SESSION_IDLE_MINUTES * 60_000);

    const row = await repo.createSession({
        userId, tokenHash: hashToken(token), expiresAt, ipAddress, userAgent
    });

    return { sessionId: row.session_id, issuedAt: row.issued_at, expiresAt: row.expires_at, token };
}

/**
 * terminateSession() — REQ-5. Invalidates the token server-side; clearing the
 * cookie alone would leave a working token in anyone's hands who copied it.
 */
async function terminateSession({ sessionId, userId, audit }) {
    if (!sessionId) return false;
    const row = await repo.terminateSession(sessionId);
    await audit?.("auth.logout", "Success", { userId, detail: "Session terminated by user" });
    return !!row;
}

/**
 * listClubMemberships() — REQ-15, REQ-16.
 */
async function listClubMemberships(userId) {
    const rows = await repo.listMemberships(userId);
    return rows.map((r) => ({
        clubId: r.club_id,
        name: r.name,
        shortName: r.short_name,
        clubType: r.club_type,
        status: r.status,
        town: r.town,
        memberId: r.member_id,
        role: r.role,
        standing: r.standing,
        joinDate: r.join_date,
        queuePosition: r.queue_position,
        memberCount: Number(r.member_count),
        ownOutstanding: r.own_outstanding   // NUMERIC string; formatted by the client
    }));
}

/**
 * switchClubContext() — REQ-17.
 *
 * Refuses with NotFound rather than Forbidden when the user does not belong to
 * the club, for the same reason as REQ-14: a 403 would confirm that the club
 * exists.
 */
async function switchClubContext({ sessionId, userId, clubId, audit }) {
    if (!clubId) throw new BadRequest("No club was specified.");

    const row = await repo.setActiveClub(sessionId, userId, clubId);

    if (!row) {
        await audit?.("auth.clubSwitch", "Refused", {
            userId,
            detail: `Attempted to enter club ${clubId} without a membership of it`,
            targetType: "club",
            targetId: clubId
        });
        throw new NotFound("That club was not found among your memberships.");
    }

    await audit?.("auth.clubSwitch", "Success", {
        userId, clubId,
        detail: `Club context set to ${clubId}`,
        targetType: "club", targetId: clubId
    });

    return { clubId: row.active_club_id };
}

/** Leaving the club context, without signing out. */
async function leaveClubContext({ sessionId }) {
    await repo.clearActiveClub(sessionId);
}

module.exports = {
    authenticate,
    establishSession,
    terminateSession,
    listClubMemberships,
    switchClubContext,
    leaveClubContext,
    GENERIC_FAILURE
};