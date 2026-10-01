"use strict";
const router = require("express").Router();
const s = require("./beneficiaries.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");
router.use(requireClubContext, authorize("beneficiary.manage"));
router.get(
  "/",
  asyncRoute(async (req, res) =>
    res.json({ beneficiaries: await s.list(req.db, req.actor.memberId) }),
  ),
);
router.put(
  "/",
  asyncRoute(async (req, res) =>
    res.json({
      beneficiaries: await s.save(req.db, req.body || {}, {
        actor: req.actor,
        audit: req.audit,
      }),
    }),
  ),
);
module.exports = router;
