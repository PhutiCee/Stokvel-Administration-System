"use strict";

/**
 * Member routes. REQ-34 to REQ-43, REQ-49.
 *
 *   GET   /api/members            the register              view.members
 *   GET   /api/members/:id        one member                view.members
 *   POST  /api/members/preview    validate + catch-up       member.register
 *   POST  /api/members            registerMember()          member.register
 *   PATCH /api/members/:id/role   assignRole()              member.assignRole
 *
 * Every route carries requireClubContext, so req.db is locked to the active
 * club and nothing here can read another club's register.
 */

const express = require("express");
const service = require("./members.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");

const router = express.Router();

router.use(requireClubContext);

// --- the register ----------------------------------------------------------
router.get("/", authorize("view.members"), asyncRoute(async (req, res) => {
    const members = await service.listMembers(req.db, {
        includeExited: req.query.includeExited === "true"
    });

    // SRS 5.3: the identity number is masked except to the member it belongs to
    // and to the Secretary. Masking happens HERE, on the server, not in the
    // browser — a field that is sent and then hidden by CSS is not hidden.
    const mayReveal = req.actor.role === "Secretary";
    res.json({
        members: members.map((m) => ({
            ...m,
            idNumber: mayReveal || m.userId === req.actor.userId
                ? m.idNumber
                : null
        })),
        canRevealIdNumbers: mayReveal
    });
}));

router.get("/:memberId", authorize("view.members"), asyncRoute(async (req, res) => {
    const member = await service.getMember(req.db, req.params.memberId);
    const mayReveal = req.actor.role === "Secretary" || member.userId === req.actor.userId;
    res.json({
        member: { ...member, idNumber: mayReveal ? member.idNumber : null }
    });
}));

// --- registration, two steps (REQ-41) --------------------------------------
// The preview writes nothing. It exists so the officer can read the catch-up
// obligation to the new member BEFORE their membership is confirmed, which is
// what the requirement asks for.
router.post("/preview", authorize("member.register"), asyncRoute(async (req, res) => {
    const result = await service.registerMember(req.db, req.body || {}, {
        actor: req.actor,
        audit: req.audit,
        preview: true
    });
    res.json(result);
}));

router.post("/", authorize("member.register"), asyncRoute(async (req, res) => {
    const result = await service.registerMember(req.db, req.body || {}, {
        actor: req.actor,
        audit: req.audit,
        preview: false
    });
    res.status(201).json(result);
}));

// --- role (REQ-7, REQ-43, REQ-49) ------------------------------------------
router.patch("/:memberId/role", authorize("member.assignRole"), asyncRoute(async (req, res) => {
    const result = await service.assignRole(req.db, req.params.memberId, req.body?.role, {
        actor: req.actor,
        audit: req.audit
    });
    res.json(result);
}));

module.exports = router;