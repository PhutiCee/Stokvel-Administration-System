"use strict";

/**
 * Club notifications.
 *
 *   GET  /api/notifications   every notification sent to this club, newest first   notification.view
 *   POST /api/notifications   broadcast one to the whole club                       notification.send (Secretary)
 */

const express = require("express");
const service = require("./notifications.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");

const router = express.Router();
router.use(requireClubContext);

const ctx = (req) => ({ actor: req.actor, audit: req.audit });

router.get("/", authorize("notification.view"), asyncRoute(async (req, res) => {
    res.json({ notifications: await service.listNotifications(req.db) });
}));

router.post("/", authorize("notification.send"), asyncRoute(async (req, res) => {
    res.status(201).json({ notification: await service.sendNotification(req.db, req.body || {}, ctx(req)) });
}));

module.exports = router;
