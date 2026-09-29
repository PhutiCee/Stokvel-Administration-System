"use strict";

/**
 * Payout routes. Use Case 3.
 *
 *   GET  /api/payouts                  every payout, newest first          payout.view
 *   GET  /api/payouts/next             what initiating now would do        payout.view
 *   GET  /api/payouts/:id              one payout, with the assessment     payout.view
 *                                      as it stands now (REQ-65)
 *   POST /api/payouts                  initiate a payout                   payout.initiate  (Treasurer)
 *   POST /api/payouts/:id/approve      approve and post it                 payout.approve   (Chairperson)
 *   POST /api/payouts/:id/cancel       cancel it before approval           payout.cancel    (Treasurer)
 *
 * The role split is the permission matrix's. The service adds the rule the
 * matrix cannot express: the account that initiated a payout can never approve
 * it, whatever role it holds.
 */

const express = require("express");
const service = require("./payouts.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");

const router = express.Router();
router.use(requireClubContext);

const ctx = (req) => ({ actor: req.actor, audit: req.audit });

router.get("/", authorize("payout.view"), asyncRoute(async (req, res) => {
    res.json({ payouts: await service.listPayouts(req.db) });
}));

// Registered before "/:payoutId" so that "next" is not read as an id.
router.get("/next", authorize("payout.view"), asyncRoute(async (req, res) => {
    res.json({ assessment: await service.previewNextPayout(req.db) });
}));

router.get("/:payoutId", authorize("payout.view"), asyncRoute(async (req, res) => {
    res.json({ payout: await service.getPayout(req.db, req.params.payoutId) });
}));

router.post("/", authorize("payout.initiate"), asyncRoute(async (req, res) => {
    res.status(201).json({ payout: await service.initiatePayout(req.db, req.body || {}, ctx(req)) });
}));

router.post("/:payoutId/approve", authorize("payout.approve"), asyncRoute(async (req, res) => {
    res.json(await service.approvePayout(req.db, req.params.payoutId, ctx(req)));
}));

router.post("/:payoutId/cancel", authorize("payout.cancel"), asyncRoute(async (req, res) => {
    res.json({ payout: await service.cancelPayout(req.db, req.params.payoutId, req.body || {}, ctx(req)) });
}));

module.exports = router;