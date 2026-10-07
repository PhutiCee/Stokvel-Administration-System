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
 * The ledger has its own module, because a ledger entry outlives the
 * contribution that caused it and is written by payouts and reversals too.
 *
 * Both routers are exported from one file because they are one workflow: a
 * cycle exists to be paid into, and a contribution has no meaning without one.
 */

const express = require("express");
const multer = require("multer");
const { BadRequest } = require("../../lib/errors");
const service = require("./contributions.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");

// REQ-53: 5 MB, held in memory only for the length of the request — nothing is
// ever written to local disk, so there is no temp file to clean up or leak.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 5 * 1024 * 1024 }
});

// --- /api/cycles -----------------------------------------------------------
const cycles = express.Router();
cycles.use(requireClubContext);
cycles.param('cycleId', (req,res,next,value) => next(
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(value)
      ? undefined : new BadRequest('The cycle identifier is invalid.')));
cycles.post('/:cycleId/close', authorize('cycle.close'), asyncRoute(async(req,res) => {
    res.json(await service.closeCycle(req.db,req.params.cycleId,{actor:req.actor,audit:req.audit}));
}));

cycles.get(
    "/",
    authorize("view.dashboard"),
    asyncRoute(async (req, res) => {
        res.json({ cycles: await service.listCycles(req.db) });
    })
);

cycles.get(
    "/current",
    authorize("view.dashboard"),
    asyncRoute(async (req, res) => {
        const detail = await service.getCycleDetail(req.db, null);
        if (!detail) return res.json({ cycle: null, contributions: [] });

        // A member sees only their own line. An officer with view.members sees the
        // whole register. Filtered HERE, on the server: a row that is sent and then
        // hidden in the browser has still been sent.
        if (
            !req.actor.role ||
            !["Treasurer", "Secretary", "Chairperson"].includes(req.actor.role)
        ) {
            detail.contributions = detail.contributions.filter(
                (c) => c.memberId === req.actor.memberId
            );
        }
        res.json(detail);
    })
);

cycles.get(
    "/:cycleId",
    authorize("view.dashboard"),
    asyncRoute(async (req, res) => {
        const detail = await service.getCycleDetail(req.db, req.params.cycleId);
        if (!detail)
            return res.status(404).json({
                error: {
                    code: "NOT_FOUND",
                    message: "That cycle was not found in this club."
                }
            });
        if (!["Treasurer", "Secretary", "Chairperson"].includes(req.actor.role)) {
            detail.contributions = detail.contributions.filter(
                (c) => c.memberId === req.actor.memberId
            );
        }
        res.json(detail);
    })
);

cycles.post(
    "/",
    authorize("cycle.open"),
    asyncRoute(async (req, res) => {
        const result = await service.openCycle(req.db, req.body || {}, {
            actor: req.actor,
            audit: req.audit
        });
        res.status(201).json(result);
    })
);

// --- /api/contributions ----------------------------------------------------
const contributions = express.Router();
contributions.use(requireClubContext);
for (const param of ["contributionId", "penaltyId"])
    contributions.param(param, (req, res, next, value) => {
        next(
            /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)
                ? undefined
                : new BadRequest("The record identifier is invalid.")
        );
    });
contributions.get(
    "/penalties",
    authorize("view.dashboard"),
    asyncRoute(async (req, res) => {
        res.json(await service.listPenalties(req.db, req.query, { actor: req.actor }));
    })
);

contributions.post(
    "/:contributionId/capture",
    authorize("contribution.capture"),
    asyncRoute(async (req, res) => {
        const result = await service.captureContribution(
            req.db,
            req.params.contributionId,
            req.body || {},
            { actor: req.actor, audit: req.audit }
        );
        res.json(result);
    })
);

contributions.post(
    "/penalties/:penaltyId/waive",
    authorize("penalty.waive"),
    asyncRoute(async (req, res) => {
        const result = await service.waivePenalty(req.db, req.params.penaltyId, req.body || {}, {
            actor: req.actor,
            audit: req.audit
        });
        res.json(result);
    })
);

// --- proof of payment (REQ-51 to REQ-53) ------------------------------------

contributions.post(
    "/:contributionId/proof",
    authorize("contribution.capture"),
    (req, res, next) =>
        upload.single("file")(req, res, (err) => {
            if (err instanceof multer.MulterError)
                return next(
                    new BadRequest(
                        err.code === "LIMIT_FILE_SIZE"
                            ? "The file is too large. The limit is 5 MB."
                            : "Attach one file using the file field."
                    )
                );
            next(err);
        }),
    asyncRoute(async (req, res) => {
        const result = await service.uploadProof(req.db, req.params.contributionId, req.file, {
            actor: req.actor,
            audit: req.audit
        });
        res.status(201).json(result);
    })
);

contributions.get(
    "/:contributionId/proof",
    authorize("view.dashboard"),
    asyncRoute(async (req, res) => {
        const meta = await service.getProofMeta(req.db, req.params.contributionId, {
            actor: req.actor
        });
        res.json({ proof: meta });
    })
);

contributions.get(
    "/:contributionId/proof/file",
    authorize("view.dashboard"),
    asyncRoute(async (req, res) => {
        const file = await service.downloadProof(req.db, req.params.contributionId, {
            actor: req.actor
        });
        res.setHeader("Content-Type", file.mime_type);
        res.setHeader(
            "Content-Disposition",
            "attachment; filename*=UTF-8''" +
                encodeURIComponent(file.original_filename).replace(/'/g, "%27")
        );
        res.setHeader("Cache-Control", "private, no-store");
        res.setHeader("X-Content-Type-Options", "nosniff");
        res.send(Buffer.from(file.file_data));
    })
);

contributions.post(
    "/:contributionId/proof/delete",
    authorize("contribution.capture"),
    asyncRoute(async (req, res) => {
        const result = await service.deleteProof(req.db, req.params.contributionId, {
            actor: req.actor,
            audit: req.audit
        });
        res.json(result);
    })
);

module.exports = { cycles, contributions };
