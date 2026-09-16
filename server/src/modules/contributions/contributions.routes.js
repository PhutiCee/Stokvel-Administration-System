"use strict";

/**
 * Cycle and contribution routes. Use Case 2.
 *
 *   GET  /api/cycles                    every cycle, newest first
 *   POST /api/cycles                    openCycle() + generateExpectedContributions()
 *   GET  /api/cycles/current            the open cycle and its register
 *   GET  /api/cycles/:cycleId
 *   POST /api/contributions/:id/capture captureContribution()
 *
 * Both routers are exported from one file because they are one workflow: a
 * cycle exists to be paid into, and a contribution has no meaning without one.
 */

const express = require("express");
const service = require("./contributions.service");
const ledger = require("../ledger/ledger.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");

// --- /api/cycles -----------------------------------------------------------
const cycles = express.Router();
cycles.use(requireClubContext);

cycles.get("/", authorize("view.dashboard"), asyncRoute(async (req, res) => {
    res.json({ cycles: await service.listCycles(req.db) });
}));

cycles.get("/current", authorize("view.dashboard"), asyncRoute(async (req, res) => {
    const detail = await service.getCycleDetail(req.db, null);
    if (!detail) return res.json({ cycle: null, contributions: [] });

    // A member sees only their own line. An officer with view.members sees the
    // whole register. Filtered HERE, on the server: a row that is sent and then
    // hidden in the browser has still been sent.
    if (!req.actor.role || !["Treasurer", "Secretary", "Chairperson"].includes(req.actor.role)) {
        detail.contributions = detail.contributions.filter((c) => c.memberId === req.actor.memberId);
    }
    res.json(detail);
}));

cycles.get("/:cycleId", authorize("view.dashboard"), asyncRoute(async (req, res) => {
    const detail = await service.getCycleDetail(req.db, req.params.cycleId);
    if (!detail) return res.status(404).json({
        error: { code: "NOT_FOUND", message: "That cycle was not found in this club." }
    });
    if (!["Treasurer", "Secretary", "Chairperson"].includes(req.actor.role)) {
        detail.contributions = detail.contributions.filter((c) => c.memberId === req.actor.memberId);
    }
    res.json(detail);
}));

cycles.post("/", authorize("cycle.open"), asyncRoute(async (req, res) => {
    const result = await service.openCycle(req.db, req.body || {}, {
        actor: req.actor, audit: req.audit
    });
    res.status(201).json(result);
}));

// --- /api/contributions ----------------------------------------------------
const contributions = express.Router();
contributions.use(requireClubContext);

contributions.post("/:contributionId/capture", authorize("contribution.capture"),
    asyncRoute(async (req, res) => {
        const result = await service.captureContribution(
            req.db, req.params.contributionId, req.body || {},
            { actor: req.actor, audit: req.audit }
        );
        res.json(result);
    })
);

// --- /api/ledger -----------------------------------------------------------
const ledgerRouter = express.Router();
ledgerRouter.use(requireClubContext);

ledgerRouter.get("/", authorize("view.ledger"), asyncRoute(async (req, res) => {
    const [entries, balance] = await Promise.all([
        ledger.listEntries(req.db, { limit: Number(req.query.limit) || 100 }),
        ledger.getPoolBalance(req.db)
    ]);
    res.json({
        entries: entries.map((e) => ({
            entryId: e.entry_id,
            entryType: e.entry_type,
            amount: e.amount,
            resultingBalance: e.resulting_balance,
            description: e.description,
            reference: e.reference,
            reversesId: e.reverses_id,
            reason: e.reason,
            postedAt: e.posted_at,
            postedByName: e.posted_by_name,
            memberName: e.member_name
        })),
        poolBalance: balance.balance,
        entryCount: balance.entryCount
    });
}));

module.exports = { cycles, contributions, ledger: ledgerRouter };