"use strict";
const router = require("express").Router(),
  s = require("./exits.service");
const { requireClubContext } = require("../../middleware/tenancy"),
  { authorize } = require("../../middleware/authorize"),
  { asyncRoute } = require("../../middleware/errors"),
  { BadRequest } = require("../../lib/errors");
const ctx = (req) => ({ actor: req.actor, audit: req.audit });
router.use(requireClubContext);
router.param("id", (req, res, next, id) =>
  next(
    /^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(id)
      ? undefined
      : new BadRequest("Invalid exit notice."),
  ),
);
router.get(
  "/writeoff-candidates",
  authorize("governance.record"),
  asyncRoute(async (req, res) =>
    res.json({
      candidates: await require("./writeoffs.repo").candidates(req.db),
    }),
  ),
);
router.get(
  "/settings",
  authorize("view.dashboard"),
  asyncRoute(async (req, res) => res.json(await s.settings(req.db))),
);
router.post(
  "/settings",
  authorize("exit.configure"),
  asyncRoute(async (req, res) =>
    res
      .status(201)
      .json(await s.recordPolicy(req.db, req.body || {}, ctx(req))),
  ),
);
router.get(
  "/",
  authorize("view.dashboard"),
  asyncRoute(async (req, res) =>
    res.json({ notices: await s.list(req.db, req.actor) }),
  ),
);
router.post(
  "/",
  authorize("exit.notice"),
  asyncRoute(async (req, res) =>
    res.status(201).json(await s.submit(req.db, req.body || {}, ctx(req))),
  ),
);
router.post(
  "/:id/assess",
  authorize("exit.assess"),
  asyncRoute(async (req, res) =>
    res.json(await s.reassess(req.db, req.params.id, ctx(req))),
  ),
);
router.post(
  "/:id/decision",
  authorize("exit.notice"),
  asyncRoute(async (req, res) =>
    res.json(await s.decide(req.db, req.params.id, req.body || {}, ctx(req))),
  ),
);
module.exports = router;
