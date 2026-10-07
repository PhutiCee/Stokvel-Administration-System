"use strict";
const express = require("express");
const { pool } = require("../../db/pool");
const { requireSession } = require("../../middleware/authenticate");
const { asyncRoute } = require("../../middleware/errors");
const { Forbidden, NotFound } = require("../../lib/errors");
const service = require("../platform/platform.service");
const router = express.Router();
router.use(requireSession);
router.get("/eligibility", asyncRoute(async (req, res) => {
  try { await service.requireChairpersonApplicant(req.actor); res.json({ canCreate: true }); }
  catch (err) { if (!(err instanceof Forbidden)) throw err; res.json({ canCreate: false }); }
}));
router.post("/", asyncRoute(async (req, res) => {
  res.status(201).json(await service.createClub(req.body || {}, {
    actor: req.actor, audit: req.audit, pendingApproval: true
  }));
}));
// Only the selected club's own members can see its application status.
router.get("/current", asyncRoute(async (req, res) => {
  if (req.actor.isPlatformAdmin) throw new Forbidden("Use the platform review screen.");
  const { rows } = await pool.query(`SELECT c.club_id,c.name,c.status,c.rejection_reason,c.reviewed_at
    FROM club c JOIN member m ON m.club_id=c.club_id
    WHERE c.club_id=$1 AND m.user_id=$2 AND m.standing NOT IN ('Exited','Expelled')`,
    [req.actor.clubId, req.actor.userId]);
  if (!rows[0]) throw new NotFound("Choose one of your clubs first.");
  const c=rows[0];
  res.json({ clubId:c.club_id, name:c.name, status:c.status, rejectionReason:c.rejection_reason, reviewedAt:c.reviewed_at });
}));
module.exports = router;
