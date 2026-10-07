"use strict";

/**
 * Reconciliation. REQ-96 to REQ-98.
 *
 *   GET  /api/reconciliation   past checks and the live ledger balance   view.reconciliation
 *   POST /api/reconciliation   record a check against a typed bank balance   reconciliation.record
 */

const express = require("express");
const service = require("./reconciliation.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");

const router = express.Router();
router.use(requireClubContext);

const ctx = (req) => ({ actor: req.actor, audit: req.audit });

router.get("/", authorize("view.reconciliation"), asyncRoute(async (req, res) => {
    res.json(await service.listReconciliations(req.db));
}));

router.post("/", authorize("reconciliation.record"), asyncRoute(async (req, res) => {
    res.status(201).json({ reconciliation: await service.reconcile(req.db, req.body || {}, ctx(req)) });
}));

router.post('/:id/resolve',authorize('reconciliation.record'),asyncRoute(async(req,res)=>{
  if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(req.params.id))throw new (require('../../lib/errors').BadRequest)('Invalid reconciliation identifier.');
  res.json(await service.resolve(req.db,req.params.id,req.body||{},ctx(req)));
}));
module.exports = router;
