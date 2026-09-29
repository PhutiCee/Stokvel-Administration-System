"use strict";

/**
 * Payout queue routes. Use Case 3.
 *
 *   GET  /api/queue                          the queue, projected dates, open exchanges   REQ-71, REQ-78
 *   GET  /api/queue/me                       my position and the date I reach the head    REQ-78
 *   POST /api/queue/establish                set the order by the constitution            REQ-71
 *   POST /api/queue/arrears-ruling           defer, or pay notwithstanding arrears        REQ-77
 *   POST /api/queue/swaps                    ask to exchange places                       REQ-74
 *   POST /api/queue/swaps/:id/consent        the other member answers                     REQ-75
 *   POST /api/queue/swaps/:id/approve        the Chairperson effects it                   REQ-75, REQ-76
 *   POST /api/queue/swaps/:id/reject         the Chairperson refuses it
 *   POST /api/queue/swaps/:id/cancel         the requester withdraws it
 */

const express = require("express");
const service = require("./queue.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");

const router = express.Router();
router.use(requireClubContext);

const ctx = (req) => ({ actor: req.actor, audit: req.audit });
const viewer = (req) => ({ memberId: req.actor.memberId, role: req.actor.role });

router.get("/", authorize("view.queue"), asyncRoute(async (req, res) => {
    res.json(await service.getQueue(req.db, { viewer: viewer(req) }));
}));

router.get("/me", authorize("view.queue"), asyncRoute(async (req, res) => {
    res.json(await service.getOwnPosition(req.db, { viewer: viewer(req) }));
}));

router.post("/establish", authorize("queue.establish"), asyncRoute(async (req, res) => {
    res.json(await service.establishQueue(req.db, req.body || {}, ctx(req)));
}));

router.post("/arrears-ruling", authorize("queue.resolveArrears"), asyncRoute(async (req, res) => {
    res.status(201).json(await service.resolveArrears(req.db, req.body || {}, ctx(req)));
}));

router.post("/swaps", authorize("queue.requestSwap"), asyncRoute(async (req, res) => {
    res.status(201).json(await service.requestSwap(req.db, req.body || {}, ctx(req)));
}));

router.post("/swaps/:swapId/consent", authorize("queue.consentSwap"), asyncRoute(async (req, res) => {
    res.json(await service.consentToSwap(req.db, req.params.swapId, req.body || {}, ctx(req)));
}));

router.post("/swaps/:swapId/approve", authorize("queue.approveSwap"), asyncRoute(async (req, res) => {
    res.json(await service.approveSwap(req.db, req.params.swapId, ctx(req)));
}));

router.post("/swaps/:swapId/reject", authorize("queue.approveSwap"), asyncRoute(async (req, res) => {
    res.json(await service.rejectSwap(req.db, req.params.swapId, req.body || {}, ctx(req)));
}));

router.post("/swaps/:swapId/cancel", authorize("queue.requestSwap"), asyncRoute(async (req, res) => {
    res.json(await service.cancelSwap(req.db, req.params.swapId, ctx(req)));
}));

module.exports = router;