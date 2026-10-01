"use strict";
const router = require("express").Router(),
  s = require("./announcements.service");
const { requireClubContext } = require("../../middleware/tenancy"),
  { authorize } = require("../../middleware/authorize"),
  { asyncRoute } = require("../../middleware/errors");
router.use(requireClubContext);
router.get(
  "/",
  authorize("view.dashboard"),
  asyncRoute(async (req, res) =>
    res.json(await s.list(req.db, req.query.offset)),
  ),
);
router.post(
  "/",
  authorize("announcement.publish"),
  asyncRoute(async (req, res) =>
    res.status(201).json(
      await s.publish(req.db, req.body || {}, {
        actor: req.actor,
        audit: req.audit,
      }),
    ),
  ),
);
module.exports = router;
