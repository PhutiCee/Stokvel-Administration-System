"use strict";
const express = require("express");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");
const { BadRequest, Forbidden } = require("../../lib/errors");
const { can } = require("../../rules/permissions");
const service = require("./assistant.service");
const router = express.Router();
router.use(requireClubContext);
router.post(
  "/",
  authorize("assistant.ask"),
  asyncRoute(async (req, res) => {
    const question = req.body?.question;
    if (
      typeof question !== "string" ||
      !question.trim() ||
      question.trim().length > 500
    )
      throw new BadRequest("Ask a question of between 1 and 500 characters.");
    if (!req.actor.memberId)
      throw new Forbidden("Select your club membership first.");
    const intent = service.classify(question.trim());
    if (!can(req.actor.role, intent.permission))
      throw new Forbidden("Your club role cannot access these records.");
    res.json(await service.ask(req.db, question.trim(), intent, req.actor));
  }),
);
module.exports = router;
