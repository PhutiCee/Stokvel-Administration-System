"use strict";
const router = require("express").Router();
const { requireClubContext } = require("../../middleware/tenancy"),
  { authorize } = require("../../middleware/authorize"),
  { asyncRoute } = require("../../middleware/errors");
router.use(requireClubContext, authorize("view.dashboard"));
router.get(
  "/",
  asyncRoute(async (req, res) =>
    res.json(await require("./dashboard.service").get(req.db, req.actor)),
  ),
);
module.exports = router;
