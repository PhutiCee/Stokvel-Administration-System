"use strict";

/**
 * Distribution routes. Use Case 3, accumulating clubs.
 *
 *   GET  /api/distributions                  every distribution, newest first   distribution.view
 *   GET  /api/distributions/next             what initiating now would compute  distribution.view
 *   GET  /api/distributions/:id              one distribution, itemised         distribution.view
 *   POST /api/distributions                  initiate it                        distribution.initiate  (Treasurer)
 *   POST /api/distributions/:id/approve      approve and post it                distribution.approve   (Chairperson)
 *   POST /api/distributions/:id/cancel       cancel it before approval          distribution.cancel    (Treasurer)
 *   POST /api/distributions/interest         record interest earned            distribution.recordFinancials (Treasurer)
 *   POST /api/distributions/expense          record an administrative cost     distribution.recordFinancials (Treasurer)
 */

const express = require("express");
const service = require("./distributions.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");

const router = express.Router();
router.use(requireClubContext);

const ctx = (req) => ({ actor: req.actor, audit: req.audit });

router.get("/", authorize("distribution.view"), asyncRoute(async (req, res) => {
    res.json({ distributions: await service.listDistributions(req.db) });
}));

// Registered before "/:distributionId" so "next" is not read as an id.
router.get("/next", authorize("distribution.view"), asyncRoute(async (req, res) => {
    res.json(await service.previewNextDistribution(req.db));
}));

router.post("/interest", authorize("distribution.recordFinancials"), asyncRoute(async (req, res) => {
    res.status(201).json(await service.recordInterest(req.db, req.body || {}, ctx(req)));
}));

router.post("/expense", authorize("distribution.recordFinancials"), asyncRoute(async (req, res) => {
    res.status(201).json(await service.recordExpense(req.db, req.body || {}, ctx(req)));
}));

router.get("/:distributionId", authorize("distribution.view"), asyncRoute(async (req, res) => {
    res.json({ distribution: await service.getDistribution(req.db, req.params.distributionId) });
}));

router.post("/", authorize("distribution.initiate"), asyncRoute(async (req, res) => {
    res.status(201).json({ distribution: await service.initiateDistribution(req.db, ctx(req)) });
}));

router.post("/:distributionId/approve", authorize("distribution.approve"), asyncRoute(async (req, res) => {
    res.json({ distribution: await service.approveDistribution(req.db, req.params.distributionId, ctx(req)) });
}));

router.post("/:distributionId/cancel", authorize("distribution.cancel"), asyncRoute(async (req, res) => {
    res.json({ distribution: await service.cancelDistribution(req.db, req.params.distributionId, req.body || {}, ctx(req)) });
}));

module.exports = router;