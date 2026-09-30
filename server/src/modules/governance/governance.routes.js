"use strict";
const router = require("express").Router();
const service = require("./governance.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");
const ctx = (req) => ({ actor: req.actor, audit: req.audit });
router.use(requireClubContext);
router.get(
    "/annual-report",
    authorize("view.ledger"),
    asyncRoute(async (req, res) =>
        res.json(await service.annualReport(req.db, req.query.year)),
    ),
);
router.get(
    "/settings",
    authorize("view.governance"),
    asyncRoute(async (req, res) => res.json(await service.settings(req.db))),
);
router.post(
    "/settings",
    authorize("constitution.propose"),
    asyncRoute(async (req, res) =>
        res
            .status(201)
            .json(await service.recordPolicy(req.db, req.body || {}, ctx(req))),
    ),
);
router.get(
    "/proposals",
    authorize("view.governance"),
    asyncRoute(async (req, res) => res.json(await service.proposals(req.db))),
);
router.post(
    "/proposals",
    authorize("constitution.propose"),
    asyncRoute(async (req, res) =>
        res
            .status(201)
            .json(
                await service.proposeAmendment(
                    req.db,
                    req.body || {},
                    ctx(req),
                ),
            ),
    ),
);

router.get(
    "/",
    authorize("view.governance"),
    asyncRoute(async (req, res) => res.json(await service.list(req.db))),
);
router.get(
    "/candidates",
    authorize("governance.record"),
    asyncRoute(async (req, res) =>
        res.json(await service.candidates(req.db, req.query.date)),
    ),
);
router.get(
    "/:id",
    authorize("view.governance"),
    asyncRoute(async (req, res) =>
        res.json(await service.detail(req.db, req.params.id)),
    ),
);
router.post(
    "/",
    authorize("governance.record"),
    asyncRoute(async (req, res) =>
        res
            .status(201)
            .json(
                await service.recordMeeting(req.db, req.body || {}, ctx(req)),
            ),
    ),
);
router.post(
    "/:id/resolutions",
    authorize("governance.record"),
    asyncRoute(async (req, res) =>
        res
            .status(201)
            .json(
                await service.recordResolution(
                    req.db,
                    req.params.id,
                    req.body || {},
                    ctx(req),
                ),
            ),
    ),
);
router.post(
    "/resolutions/:id/apply",
    authorize("governance.apply"),
    asyncRoute(async (req, res) =>
        res.json(await service.giveEffect(req.db, req.params.id, ctx(req))),
    ),
);
module.exports = router;
