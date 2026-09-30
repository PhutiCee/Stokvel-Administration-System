"use strict";
const repo = require("./reversals.repo");
const ledger = require("./ledger.service");
const { withClubTransaction } = require("../../db/tx");
const { toCents, toNumeric } = require("../../lib/money");
const {
  BadRequest,
  NotFound,
  RuleRefusal,
  Forbidden,
} = require("../../lib/errors");
const needsApproval = (e) => ["Payout", "Claim"].includes(e.entry_type);
function reason(value) {
  if (
    typeof value !== "string" ||
    value.trim().length < 3 ||
    value.trim().length > 2000
  )
    throw new BadRequest("Record a reason between 3 and 2000 characters.");
  return value.trim();
}
async function run(db, ctx, action, role, fn) {
  try {
    if (ctx.actor.role !== role)
      throw new Forbidden(`Only the ${role} may perform this operation.`);
    const result = await withClubTransaction(db.clubId, async (tx, client) => {
      await repo.lockClub(tx);
      return fn(tx, client);
    });
    await ctx.audit(action, "Success", {
      targetType: "ledger_entry",
      targetId: result.entry_id,
      detail: `${action}: ${result.reason}`,
    });
    return result;
  } catch (err) {
    if (err.status) await ctx.audit(action, "Refused", { detail: err.message });
    throw err;
  }
}
async function original(db, id) {
  const e = await repo.getEntry(db, id);
  if (!e) throw new NotFound("That entry was not found in this club.");
  if (e.reversed_by)
    throw new RuleRefusal("This entry has already been reversed.");
  if (e.reverses_id || e.entry_type === "Reversal")
    throw new RuleRefusal("A reversing entry cannot itself be reversed.");
  if (e.entry_type === "Penalty")
    throw new RuleRefusal(
      "Use the Chairperson penalty-waiver action so the penalty record and ledger remain consistent (REQ-63).",
    );
  return e;
}
async function post(tx, client, r, e, actor) {
  const entry = await ledger.appendEntry(client, {
    clubId: tx.clubId,
    memberId: e.member_id,
    entryType: "Reversal",
    amount: toNumeric(-toCents(e.amount)),
    description: `Reversal: ${e.description}`,
    reference: e.reference,
    reversesId: e.entry_id,
    reason: r.reason,
    contributionId: e.contribution_id,
    penaltyId: e.penalty_id,
    postedBy: actor.userId,
  });
  return repo.posted(tx, r.request_id, entry.entryId, actor.userId);
}
async function reverse(db, id, input, ctx) {
  return run(db, ctx, "ledger.reverse", "Treasurer", async (tx, client) => {
    const why = reason(input.reason),
      e = await original(tx, id);
    if (await repo.liveRequest(tx, id))
      throw new RuleRefusal(
        "A reversal request already exists for this entry.",
      );
    const r = await repo.create(tx, id, why, ctx.actor.userId);
    return needsApproval(e) ? r : post(tx, client, r, e, ctx.actor);
  });
}
async function decide(db, id, input, ctx) {
  return run(db, ctx, "ledger.reverseDecision", "Chairperson", async (tx) => {
    const r = await repo.getRequest(tx, id);
    if (!r) throw new NotFound("That request was not found in this club.");
    if (r.status !== "Pending")
      throw new RuleRefusal("This request is no longer pending.");
    await original(tx, r.entry_id);
    if (r.requested_by === ctx.actor.userId)
      throw new RuleRefusal("The requester cannot approve their own reversal.");
    if (!["approve", "reject"].includes(input.decision))
      throw new BadRequest("Choose approve or reject.");
    return repo.decide(
      tx,
      id,
      ctx.actor.userId,
      input.decision === "approve" ? "Approved" : "Rejected",
      input.decision === "reject" ? reason(input.reason) : null,
    );
  });
}
async function postApproved(db, id, ctx) {
  return run(db, ctx, "ledger.reversePost", "Treasurer", async (tx, client) => {
    const r = await repo.getRequest(tx, id);
    if (!r) throw new NotFound("That request was not found in this club.");
    if (r.status !== "Approved")
      throw new RuleRefusal("Chairperson approval is required before posting.");
    if (r.decided_by === ctx.actor.userId)
      throw new RuleRefusal("The approver cannot post this reversal.");
    return post(tx, client, r, await original(tx, r.entry_id), ctx.actor);
  });
}
module.exports = { reverse, decide, postApproved, list: repo.list };
