"use strict";

/**
 * Platform administration routes. REQ-18, REQ-20.
 *
 *   GET   /api/platform            aggregate figures and the club list
 *   POST  /api/platform/clubs      createClub()
 *   PATCH /api/platform/clubs/:id  suspendClub() / reinstateClub()
 *
 * requirePlatformAdmin guards all of them, and it is the mirror image of
 * requireClubContext: this router refuses anybody WITH a club role, and the
 * club routers refuse the platform administrator. The two sets do not overlap
 * anywhere, which is BR-10 expressed in routing rather than in a comment.
 */

const express = require("express");
const service = require("./platform.service");
const { requirePlatformAdmin } = require("../../middleware/tenancy");
const { asyncRoute } = require("../../middleware/errors");
const { BadRequest } = require("../../lib/errors");

const router = express.Router();
router.use(requirePlatformAdmin);

router.get("/", asyncRoute(async (req, res) => {
    const [stats, clubs] = await Promise.all([service.aggregate(), service.listClubs()]);
    res.json({ stats, clubs });
}));

router.post("/clubs", asyncRoute(async (req, res) => {
    const result = await service.createClub(req.body || {}, {
        actor: req.actor, audit: req.audit
    });
    res.status(201).json(result);
}));

router.patch("/clubs/:clubId", asyncRoute(async (req, res) => {
    const { status, reason } = req.body || {};

    if (status === "Suspended") {
        // A suspension stops a club's members transacting, so the reason is
        // recorded rather than left to memory.
        if (!reason || !String(reason).trim()) {
            throw new BadRequest("Record why this club is being suspended.", {
                fields: { reason: "A reason is required." }
            });
        }
        return res.json(await service.suspendClub(req.params.clubId, {
            actor: req.actor, audit: req.audit, reason: String(reason).trim()
        }));
    }

    if (status === "Active") {
        return res.json(await service.reinstateClub(req.params.clubId, {
            actor: req.actor, audit: req.audit, reason: reason || null
        }));
    }

    throw new BadRequest("A club status must be either Active or Suspended.");
}));

module.exports = router;