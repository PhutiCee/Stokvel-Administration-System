"use strict";

/**
 * Ledger routes. REQ-88 to REQ-95.
 *
 *   GET /api/ledger                     the club book          view.ledger
 *   GET /api/ledger/statement           my own statement       view.ownStatement
 *   GET /api/ledger/statement/:memberId another member's       view.ledger
 *   GET /api/ledger/pool                the pool balance       view.pool
 *
 * The split between the first two matters. REQ-94 gives every member their own
 * statement, and REQ-95 gives every member the pool balance — neither requires
 * view.ledger, which is the officer's permission to read the whole book. An
 * ordinary member can always answer "what have I paid" and "what is in the
 * pool" without being able to see anybody else's line.
 */

const express = require("express");
const reversals = require("./reversals.service");
const service = require("./ledger.service");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");
const { NotFound, Forbidden, BadRequest } = require("../../lib/errors");

const router = express.Router();
router.use(requireClubContext);

for(const param of ["entryId","requestId"])router.param(param,(req,res,next,value)=>next(
 /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)?undefined:new BadRequest("Invalid ledger identifier.")));
const ctx=req=>({actor:req.actor,audit:req.audit});
router.get("/reversals",authorize("view.ledger"),asyncRoute(async(req,res)=>res.json({requests:await reversals.list(req.db)})));
router.post("/:entryId/reverse",authorize("ledger.reverse"),asyncRoute(async(req,res)=>res.status(201).json(await reversals.reverse(req.db,req.params.entryId,req.body||{},ctx(req)))));
router.post("/reversals/:requestId/decision",authorize("ledger.reverseApprove"),asyncRoute(async(req,res)=>res.json(await reversals.decide(req.db,req.params.requestId,req.body||{},ctx(req)))));
router.post("/reversals/:requestId/post",authorize("ledger.reverse"),asyncRoute(async(req,res)=>res.json(await reversals.postApproved(req.db,req.params.requestId,ctx(req)))));

// --- the whole book --------------------------------------------------------
router.get("/", authorize("view.ledger"), asyncRoute(async (req, res) => {
    const [entries, balance] = await Promise.all([
        service.listEntries(req.db, { limit: Math.min(Number(req.query.limit) || 100, 500) }),
        service.getPoolBalance(req.db)
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
            reversedBy: e.reversed_by,
            reason: e.reason,
            postedAt: e.posted_at,
            postedByName: e.posted_by_name,
            memberName: e.member_name
        })),
        poolBalance: balance.balance,
        entryCount: balance.entryCount
    });
}));

// --- REQ-95: the pool balance, for every member ----------------------------
router.get("/pool", authorize("view.pool"), asyncRoute(async (req, res) => {
    res.json(await service.getPoolBalance(req.db));
}));

// --- REQ-94: my own statement ----------------------------------------------
router.get("/statement", authorize("view.ownStatement"), asyncRoute(async (req, res) => {
    if (!req.actor.memberId) {
        throw new NotFound("You have no membership record in this club.");
    }
    const statement = await service.generateMemberStatement(req.db, req.actor.memberId);
    if (!statement) throw new NotFound("Your statement could not be found.");
    res.json(statement);
}));

// --- another member's statement --------------------------------------------
// Reading somebody else's account needs view.ledger, which only officers hold.
// A member asking for their own id here is let through, so the route behaves
// sensibly if the interface ever links to it with an explicit id.
router.get("/statement/:memberId", asyncRoute(async (req, res, next) => {
    const isOwn = req.params.memberId === req.actor.memberId;
    if (!isOwn) {
        const { can } = require("../../rules/permissions");
        if (!can(req.actor.role, "view.ledger")) {
            await req.audit("ledger.statementRefused", "Refused", {
                detail: `${req.actor.fullName} (${req.actor.role}) requested another member's statement`,
                targetType: "member",
                targetId: req.params.memberId
            });
            return next(new Forbidden(
                "You may only open your own statement. Another member's account is theirs to show you."
            ));
        }
    }

    const statement = await service.generateMemberStatement(req.db, req.params.memberId);
    if (!statement) throw new NotFound("That member was not found in this club.");
    res.json(statement);
}));

module.exports = router;