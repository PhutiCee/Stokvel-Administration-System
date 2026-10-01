"use strict";
const repo = require("./exits.repo");
const { withClubTransaction } = require("../../db/tx");
const { todayIso, addDays } = require("../../lib/dates");
const { toCents, toNumeric } = require("../../lib/money");
const {
  BadRequest,
  RuleRefusal,
  NotFound,
  Forbidden,
} = require("../../lib/errors");
const ledger = require("../ledger/ledger.service"),
  queue = require("../queue/queue.service");
const { validatePolicy, compute } = require("../../rules/exit-settlement");
async function calculate(tx, n) {
  const m = await repo.member(tx, n.member_id);
  if (!m || ["Exited", "Expelled"].includes(m.standing))
    throw new RuleRefusal("This membership is no longer active.");
  const start =
    n.policy.period === "membership"
      ? m.join_date
      : n.policy.period === "calendarYear"
        ? n.notice_date.slice(0, 4) + "-01-01"
        : n.cycle_start_date;
  return {
    ...compute(await repo.totals(tx, n.member_id, start), n.policy),
    periodStart: start,
    constitutionVersion: n.version,
    source: n.source,
  };
}
async function action(db, ctx, name, work) {
  try {
    const result = await withClubTransaction(db.clubId, async (tx, client) => {
      await repo.lock(tx);
      return work(tx, client);
    });
    await ctx.audit(name, "Success", {
      detail: name,
      targetType: "member",
      targetId: result.member_id || ctx.actor.memberId,
    });
    return result;
  } catch (e) {
    if (e.status) await ctx.audit(name, "Refused", { detail: e.message });
    throw e;
  }
}
async function settings(db) {
  const k = await repo.constitution(db, todayIso());
  if (!k) throw new RuleRefusal("No constitution is in force.");
  return {
    constitution: {
      id: k.constitution_id,
      version: k.version,
      noticeDays: k.exit_notice_days,
      rule: k.forfeiture_rule,
    },
    mapping: await repo.mapping(db, k.constitution_id),
  };
}
async function recordPolicy(db, input, ctx) {
  return action(db, ctx, "exit.recordRule", async (tx) => {
    if (ctx.actor.role !== "Chairperson")
      throw new Forbidden(
        "Only Chairperson may record the adopted rule mapping.",
      );
    const k = await repo.constitution(tx, todayIso());
    if (!k || k.constitution_id !== input.constitutionId)
      throw new RuleRefusal("The constitution changed. Reload it.");
    if (!k.forfeiture_rule?.trim() || input.attest !== true)
      throw new BadRequest(
        "Confirm that the calculation implements the full adopted rule without changing it.",
      );
    if (await repo.mapping(tx, k.constitution_id))
      throw new RuleRefusal(
        "This version already has an immutable calculation mapping. Amend the constitution for rule changes.",
      );
    return repo.recordMapping(
      tx,
      k,
      validatePolicy(input.policy),
      ctx.actor.userId,
    );
  });
}
async function submit(db, input, ctx) {
  return action(db, ctx, "exit.notice", async (tx) => {
    const own = await repo.member(tx, ctx.actor.memberId);
    if (!own || ["Exited", "Expelled"].includes(own.standing))
      throw new Forbidden("An active membership is required.");
    if (await repo.pending(tx, own.member_id))
      throw new RuleRefusal("You already have a pending exit notice.");
    const k = await repo.constitution(tx, todayIso()),
      map = k && (await repo.mapping(tx, k.constitution_id));
    if (!map)
      throw new RuleRefusal(
        "The adopted forfeiture rule needs its calculation mapping before a notice can be computed.",
      );
    const { notice_id } = await repo.create(tx, {
      memberId: own.member_id,
      today: todayIso(),
      earliest: addDays(todayIso(), k.exit_notice_days),
      mappingId: map.mapping_id,
      userId: ctx.actor.userId,
    });
    const n = await repo.notice(tx, notice_id);
    await repo.assess(tx, notice_id, await calculate(tx, n), ctx.actor.userId);
    return n;
  });
}
async function reassess(db, id, ctx) {
  return action(db, ctx, "exit.assess", async (tx) => {
    if (ctx.actor.role !== "Treasurer")
      throw new Forbidden(
        "Only Treasurer prepares the settlement for approval.",
      );
    const n = await repo.notice(tx, id);
    if (!n) throw new NotFound("Exit notice not found.");
    if (n.status !== "Pending")
      throw new RuleRefusal("This notice is no longer pending.");
    return repo.assess(tx, id, await calculate(tx, n), ctx.actor.userId);
  });
}
async function decide(db, id, input, ctx) {
  return action(db, ctx, "exit.decide", async (tx, client) => {
    const n = await repo.notice(tx, id);
    if (!n) throw new NotFound("Exit notice not found.");
    if (n.status !== "Pending")
      throw new RuleRefusal("This notice is no longer pending.");
    if (input.decision === "cancel") {
      if (
        n.member_id !== ctx.actor.memberId &&
        ctx.actor.role !== "Chairperson"
      )
        throw new Forbidden("Only the applicant or Chairperson may cancel.");
      if (typeof input.reason !== "string" || !input.reason.trim())
        throw new BadRequest("Record the cancellation reason.");
      return repo.decide(tx, id, {
        status: "Cancelled",
        userId: ctx.actor.userId,
        reason: input.reason.trim(),
      });
    }
    if (input.decision !== "approve")
      throw new BadRequest("Choose approve or cancel.");
    if (ctx.actor.role !== "Chairperson" || ctx.actor.memberId === n.member_id)
      throw new Forbidden(
        "A Chairperson other than the exiting member must approve.",
      );
    if (todayIso() < n.earliest_exit)
      throw new RuleRefusal(`The notice period ends on ${n.earliest_exit}.`);
    const a = await repo.latest(tx, id),
      assessor = a && (await repo.assessor(tx, a.assessed_by));
    if (
      !a ||
      assessor?.role !== "Treasurer" ||
      ["Exited", "Expelled"].includes(assessor?.standing) ||
      a.assessed_by === ctx.actor.userId
    )
      throw new RuleRefusal(
        "A current Treasurer must prepare the settlement before a different Chairperson approves.",
      );
    const calc = await calculate(tx, n);
    if (
      JSON.stringify(calc) !== JSON.stringify(a.calculation) &&
      Object.keys(calc).some((k) => calc[k] !== a.calculation[k])
    )
      throw new RuleRefusal(
        "Financial inputs changed. Ask the Treasurer to refresh the assessment.",
      );
    const m = await repo.member(tx, n.member_id),
      g = await repo.safeguards(tx, n.member_id);
    if (
      (m.role === "Chairperson" && g.chairs <= 1) ||
      (m.role === "Treasurer" && g.treasurers <= 1)
    )
      throw new RuleRefusal(
        "Assign another holder before exiting the last Chairperson or Treasurer.",
      );
    let writeoff = null;
    if (input.writeoffResolutionId) {
      if (
        !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(
          input.writeoffResolutionId,
        )
      )
        throw new BadRequest("Invalid write-off resolution.");
      writeoff = await require("../governance/governance.repo").getResolution(
        tx,
        input.writeoffResolutionId,
      );
      if (!writeoff)
        throw new NotFound("Write-off resolution not found in this club.");
      require("../../rules/governance").assertEffectable(writeoff);
      const snapshot = await require("./writeoffs.repo").snapshot(
        tx,
        n.notice_id,
      );
      if (
        !snapshot ||
        !require("node:util").isDeepStrictEqual(
          snapshot,
          writeoff.payload?.exitWriteOff,
        )
      )
        throw new RuleRefusal(
          "The voted debt snapshot does not match this pending exit. Record a fresh resolution if the debts changed.",
        );
    }
    if (g.head === m.member_id && toCents(calc.outstanding) > 0 && !writeoff)
      throw new RuleRefusal(
        "The queue head must settle outstanding contributions or select a carried resolution writing off those exact debts.",
      );
    if (g.pending_payouts)
      throw new RuleRefusal(
        "Resolve the pending payout for this member before exit.",
      );
    const pool = await ledger.getPoolBalance(tx);
    if (toCents(pool.balance) < toCents(calc.repayable))
      throw new RuleRefusal("The pool cannot fund this repayment.");
    if (writeoff) {
      await require("../governance/governance.repo").markApplied(
        tx,
        writeoff.resolution_id,
        ctx.actor.userId,
        null,
      );
      await require("./writeoffs.repo").apply(
        tx,
        n,
        writeoff,
        ctx.actor.userId,
      );
      await ledger.appendEntry(client, {
        clubId: tx.clubId,
        memberId: m.member_id,
        entryType: "Adjustment",
        amount: "0.00",
        description: `Contribution debt of ZAR ${writeoff.payload.exitWriteOff.amount} written off by resolution; no cash received.`,
        reference: writeoff.resolution_id,
        postedBy: ctx.actor.userId,
      });
    }
    let payoutId = null,
      repaymentId = null;
    if (toCents(calc.repayable) > 0) {
      payoutId = (await repo.payout(tx, n, a, ctx.actor.userId)).payout_id;
      repaymentId = (
        await ledger.appendEntry(client, {
          clubId: tx.clubId,
          memberId: m.member_id,
          entryType: "Payout",
          amount: toNumeric(-toCents(calc.repayable)),
          description: `Exit repayment to ${m.full_name}`,
          reference: payoutId,
          postedBy: ctx.actor.userId,
        })
      ).entryId;
    }
    const forfeitureId = (
      await ledger.appendEntry(client, {
        clubId: tx.clubId,
        memberId: m.member_id,
        entryType: "Adjustment",
        amount: "0.00",
        description: `Exit: ${calc.forfeited} forfeited and retained in the pool; not a new cash receipt.`,
        reference: id,
        postedBy: ctx.actor.userId,
      })
    ).entryId;
    let remainingPenalty = toCents(calc.penaltyDeduction);
    for (const penalty of await repo.unpaidPenalties(tx, m.member_id)) {
      const applied = Math.min(
        remainingPenalty,
        toCents(penalty.amount) - toCents(penalty.settled_amount),
      );
      if (applied > 0)
        await repo.settlePenalty(
          tx,
          penalty.penalty_id,
          toNumeric(toCents(penalty.settled_amount) + applied),
        );
      remainingPenalty -= applied;
    }
    await queue.removeFromQueue(tx, m.member_id);
    await repo.endMember(tx, m.member_id, todayIso());
    return repo.decide(tx, id, {
      status: "Approved",
      userId: ctx.actor.userId,
      reason: "Approved assessed settlement",
      assessmentId: a.assessment_id,
      repaymentId,
      forfeitureId,
      payoutId,
      writeoffResolutionId: writeoff?.resolution_id,
    });
  });
}
const list = (db, actor) =>
  repo.list(
    db,
    ["Chairperson", "Treasurer", "Secretary"].includes(actor.role)
      ? null
      : actor.memberId,
  );
module.exports = {
  settings,
  recordPolicy,
  submit,
  reassess,
  decide,
  list,
  compute,
  validatePolicy,
};
