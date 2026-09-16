"use strict";

/**
 * Authentication routes. Use Case 1.
 *
 *   POST   /api/auth/login        authenticate() + establishSession()
 *   POST   /api/auth/logout       terminateSession()
 *   GET    /api/auth/me           who am I, and in which club
 *   GET    /api/auth/clubs        listClubMemberships()
 *   POST   /api/auth/club         switchClubContext()
 *   DELETE /api/auth/club         leave the club context
 *
 * These handlers translate HTTP to service calls and back. They contain no
 * rules of their own.
 */

const express = require("express");
const service = require("./auth.service");
const { env } = require("../../config/env");
const { requireSession } = require("../../middleware/authenticate");
const { asyncRoute } = require("../../middleware/errors");
const { MATRIX } = require("../../rules/permissions");

const router = express.Router();

/**
 * Session cookie.
 *
 *   httpOnly  — JavaScript cannot read it, so an injected script cannot steal
 *               the session. This is why the token is not returned in the body.
 *   sameSite  — 'lax' in development, where the web app and API share
 *               localhost; 'none' in production, where they are different
 *               origins and the cookie must survive a cross-site request.
 *   secure    — required whenever sameSite is 'none'.
 */
function cookieOptions(expiresAt) {
    return {
        httpOnly: true,
        secure: env.isProduction,
        sameSite: env.isProduction ? "none" : "lax",
        expires: expiresAt,
        path: "/"
    };
}

// ---------------------------------------------------------------------------
// POST /api/auth/login
// ---------------------------------------------------------------------------
router.post("/login", asyncRoute(async (req, res) => {
    const { identifier, password } = req.body || {};

    const result = await service.authenticate({
        identifier,
        password,
        ipAddress: req.clientIp,
        userAgent: req.headers["user-agent"] || null,
        audit: req.audit
    });

    res.cookie(env.SESSION_COOKIE_NAME, result.token, cookieOptions(result.session.expiresAt));

    // The token is NOT in this body. It is in an httpOnly cookie and nowhere else.
    res.status(200).json({
        user: result.user,
        session: { expiresAt: result.session.expiresAt },
        // Where the web app should go next: a platform administrator has no
        // clubs to choose between.
        next: result.user.isPlatformAdmin ? "/platform" : "/select-club"
    });
}));

// ---------------------------------------------------------------------------
// POST /api/auth/logout
// ---------------------------------------------------------------------------
router.post("/logout", asyncRoute(async (req, res) => {
    if (req.actor) {
        await service.terminateSession({
            sessionId: req.actor.sessionId,
            userId: req.actor.userId,
            audit: req.audit
        });
    }
    res.clearCookie(env.SESSION_COOKIE_NAME, { path: "/" });
    res.status(200).json({ ok: true });
}));

// ---------------------------------------------------------------------------
// GET /api/auth/me
// ---------------------------------------------------------------------------
// The web app calls this on load to decide what to render. The permissions
// array is sent so the interface can hide what the user cannot do — but it is
// a convenience, and the server checks again on every request regardless.
router.get("/me", requireSession, asyncRoute(async (req, res) => {
    const a = req.actor;
    res.json({
        user: {
            userId: a.userId,
            fullName: a.fullName,
            phone: a.phone,
            isPlatformAdmin: a.isPlatformAdmin
        },
        club: a.clubId ? {
            clubId: a.clubId,
            name: a.clubName,
            clubType: a.clubType,
            status: a.clubStatus
        } : null,
        membership: a.memberId ? {
            memberId: a.memberId,
            role: a.role,
            standing: a.standing
        } : null,
        role: a.role,
        permissions: MATRIX[a.role] || [],
        session: { expiresAt: a.expiresAt }
    });
}));

// ---------------------------------------------------------------------------
// GET /api/auth/clubs
// ---------------------------------------------------------------------------
router.get("/clubs", requireSession, asyncRoute(async (req, res) => {
    if (req.actor.isPlatformAdmin) {
        // BR-10: the platform administrator belongs to no club and is not
        // offered a way in.
        return res.json({ clubs: [] });
    }
    const clubs = await service.listClubMemberships(req.actor.userId);
    res.json({ clubs });
}));

// ---------------------------------------------------------------------------
// POST /api/auth/club     { clubId }
// ---------------------------------------------------------------------------
router.post("/club", requireSession, asyncRoute(async (req, res) => {
    const { clubId } = req.body || {};
    const result = await service.switchClubContext({
        sessionId: req.actor.sessionId,
        userId: req.actor.userId,
        clubId,
        audit: req.audit
    });
    res.json(result);
}));

// ---------------------------------------------------------------------------
// DELETE /api/auth/club
// ---------------------------------------------------------------------------
router.delete("/club", requireSession, asyncRoute(async (req, res) => {
    await service.leaveClubContext({ sessionId: req.actor.sessionId });
    res.json({ ok: true });
}));

module.exports = router;