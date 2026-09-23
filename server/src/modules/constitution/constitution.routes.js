"use strict";

/**
 * Constitution routes. Read only.
 *
 *   GET /api/constitution/versions             every version, newest first     REQ-30
 *   GET /api/constitution/in-force?date=       the version in force on a date  REQ-31
 *
 * There is no route to record an amendment. REQ-32 requires a member
 * resolution first, and that arrives with governance (Use Case 7). See
 * constitution.service.js.
 *
 * GET /api/club/constitution still returns the version in force today, for the
 * pages that already use it.
 */

const express = require("express");
const service = require("./constitution.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");

const router = express.Router();
router.use(requireClubContext);

router.get("/versions", authorize("view.constitution"), asyncRoute(async (req, res) => {
    const versions = await service.listVersions(req.db);
    res.json({ versions: versions.slice().reverse() });
}));

router.get("/in-force", authorize("view.constitution"), asyncRoute(async (req, res) => {
    const date = typeof req.query.date === "string" && req.query.date ? req.query.date : null;
    const constitution = await service.findVersionInForceOn(req.db, date);
    res.json({ constitution });
}));

module.exports = router;