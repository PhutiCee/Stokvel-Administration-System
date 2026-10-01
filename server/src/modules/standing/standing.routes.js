"use strict";

/**
 * Standing engine routes. REQ-44, REQ-101 to REQ-103.
 *
 *   POST /api/standing/run-check   an officer runs the check now
 *   GET  /api/standing/history     standing changes, newest first
 */

const express = require("express");
const service = require("./standing.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");
const { BadRequest } = require("../../lib/errors");

const router = express.Router();
router.use(requireClubContext);

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

router.post("/run-check", authorize("manage.standing"), asyncRoute(async (req, res) => {
    const result = await service.runStandingCheck(req.db, { actor: req.actor, audit: req.audit });
    res.json(result);
}));

router.get("/history", authorize("view.standing"), asyncRoute(async (req, res) => {
    const memberId = typeof req.query.memberId === "string" && req.query.memberId ? req.query.memberId : null;
    if (memberId && !UUID.test(memberId)) throw new BadRequest("That member id is not valid.");
    const history = await service.standingHistory(req.db, { memberId });
    res.json({ history });
}));

module.exports = router;