"use strict";

/**
 * Burial claim routes. Use Case 4.
 *
 *   GET  /api/claims/dependants/mine         my own recorded dependants       REQ-37
 *   POST /api/claims/dependants              record a dependant               REQ-37
 *   POST /api/claims/dependants/:id/remove   end cover for a dependant
 *
 *   GET  /api/claims                         every claim, newest lodged first claim.view (officers)
 *   GET  /api/claims/mine                    my own lodged claims             claim.lodge
 *   GET  /api/claims/:id                     one claim, with its assessment
 *   POST /api/claims                         lodge a claim                    claim.lodge   (Member)
 *   POST /api/claims/:id/initiate            start paying it                  claim.initiate (Treasurer)
 *   POST /api/claims/:id/approve             approve and post it              claim.approve  (Chairperson)
 *   POST /api/claims/:id/cancel              withdraw or cancel it            claim.cancel   (Treasurer)
 */

const express = require("express");
const service = require("./claims.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");

const router = express.Router();
router.use(requireClubContext);

const ctx = (req) => ({ actor: req.actor, audit: req.audit });

router.get("/dependants/mine", authorize("dependant.manage"), asyncRoute(async (req, res) => {
    res.json({ dependants: await service.listMyDependants(req.db, ctx(req)) });
}));

router.post("/dependants", authorize("dependant.manage"), asyncRoute(async (req, res) => {
    res.status(201).json(await service.registerDependant(req.db, req.body || {}, ctx(req)));
}));

router.post("/dependants/:dependantId/remove", authorize("dependant.manage"), asyncRoute(async (req, res) => {
    res.json(await service.removeDependant(req.db, req.params.dependantId, ctx(req)));
}));

router.get("/", authorize("claim.view"), asyncRoute(async (req, res) => {
    res.json({ claims: await service.listClaims(req.db, { actor: req.actor }) });
}));

// Registered before "/:claimId" so "mine" is not read as an id.
router.get("/mine", authorize("claim.lodge"), asyncRoute(async (req, res) => {
    res.json({ claims: await service.listClaims(req.db, { actor: req.actor, mine: true }) });
}));

router.get("/:claimId", authorize("claim.lodge"), asyncRoute(async (req, res) => {
    const claim = await service.getClaim(req.db, req.params.claimId);
    if (claim.claimant.memberId !== req.actor.memberId && !["Treasurer", "Secretary", "Chairperson"].includes(req.actor.role)) {
        return res.status(404).json({ error: "That claim was not found in this club." });
    }
    res.json({ claim });
}));

router.post("/", authorize("claim.lodge"), asyncRoute(async (req, res) => {
    res.status(201).json({ claim: await service.lodgeClaim(req.db, req.body || {}, ctx(req)) });
}));

router.post("/:claimId/initiate", authorize("claim.initiate"), asyncRoute(async (req, res) => {
    res.json({ claim: await service.initiateClaimPayment(req.db, req.params.claimId, ctx(req)) });
}));

router.post("/:claimId/approve", authorize("claim.approve"), asyncRoute(async (req, res) => {
    res.json({ claim: await service.approveClaimPayment(req.db, req.params.claimId, ctx(req)) });
}));

router.post("/:claimId/cancel", authorize("claim.cancel"), asyncRoute(async (req, res) => {
    res.json({ claim: await service.cancelClaimPayment(req.db, req.params.claimId, req.body || {}, ctx(req)) });
}));

module.exports = router;