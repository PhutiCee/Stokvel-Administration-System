"use strict";
const ledger = require("../ledger/ledger.service");
const queue = require("../queue/queue.service");
const constitution = require("../constitution/constitution.service");
const { withClubTransaction } = require("../../db/tx");
const { NotFound } = require("../../lib/errors");
const intents = [
  {
    id: "pool",
    pattern: /\b(pool|funds?)\b|\bclub(?:'s)?\s+balance\b/i,
    permission: "view.pool",
    path: "/dashboard",
  },
  {
    id: "next_recipient",
    pattern:
      /\bwho\b.*\b(paid|payout|next|receiv)|\bnext\s+(payout|recipient|person)\b/i,
    permission: "view.queue",
    path: "/queue",
  },
  {
    id: "queue",
    pattern: /\b(queue|payouts?|turn|rotation)\b|\bwhen\b.*\bpaid\b/i,
    permission: "view.queue",
    path: "/queue",
  },
  {
    id: "balance",
    pattern: /\b(balance|owe|owing|outstanding|arrears|debt)\b/i,
    permission: "view.ownStatement",
    path: "/statement",
  },
  {
    id: "history",
    pattern: /\b(contributions?|payments?|history|paid|receipts?)\b/i,
    permission: "view.ownStatement",
    path: "/statement",
  },
  {
    id: "rules",
    pattern: /\b(rules?|constitution|penalt(?:y|ies)|grace|frequency)\b/i,
    permission: "view.constitution",
    path: "/governance#constitution",
  },
  {
    id: "profile",
    pattern: /\b(profile|details|standing|contact)\b/i,
    permission: "view.ownStatement",
    path: "/statement",
  },
  {
    id: "help",
    pattern: /^\s*(hi|hey|hello|howzit|help)\b/i,
    permission: "view.ownStatement",
    path: "/statement",
  },
];
const fallback = {
  id: "unrecognised",
  permission: "view.ownStatement",
  path: "/statement",
};
function classify(question) {
  return intents.find((i) => i.pattern.test(question)) || fallback;
}
const plain = (value) =>
  String(value ?? "Not recorded").replace(/[\\`*_{}\[\]()<>#|]/g, "");
const help =
  "I can answer questions about your outstanding contributions and penalties, contribution history, queue position and projected date, the next payout recipient, the club pool and constitution. For other questions, contact your Treasurer or Secretary.";
async function answer(db, intent, actor) {
  if (intent.id === "help" || intent.id === "unrecognised") return help;
  if (intent.id === "pool") {
    const p = await ledger.getPoolBalance(db);
    return `The club's cash pool balance is **R${p.balance}**. Unpaid penalty assessments are not cash received.`;
  }
  if (intent.id === "queue" || intent.id === "next_recipient") {
    const q = await queue.getQueue(db, {
      viewer: { memberId: actor.memberId, role: actor.role },
    });
    if (!q.applicable) return "This club does not use a rotating payout queue.";
    const entry =
      intent.id === "next_recipient"
        ? q.entries[0]
        : q.entries.find((e) => e.isYou);
    if (!entry)
      return intent.id === "next_recipient"
        ? "The payout queue has not been established."
        : "You are not currently in the payout queue.";
    return `${intent.id === "next_recipient" ? `**${plain(entry.fullName)}** is next in the recorded payout queue` : `Your queue position is **${entry.position} of ${q.entries.length}**`}.\n\nProjected payout date: **${entry.projectedDate || "Not available yet"}**. This is a projection; eligibility and approval still apply.`;
  }
  if (intent.id === "rules") {
    const k = await constitution.getVersionInForceOn(db);
    return `Constitution version **${k.version}**, effective **${k.effectiveDate}**:\n\n- Contribution: **R${k.contributionAmount}**\n- Frequency: **${plain(k.cycleFrequency)}**\n- Late penalty: **R${k.penaltyAmount}**\n- Grace period: **${k.gracePeriodDays} days**\n- Quorum: **${k.quorumPercentage}%**\n\nOpen the constitution for all adopted rules.`;
  }
  const s = await ledger.generateMemberStatement(db, actor.memberId);
  if (!s) throw new NotFound("Your statement was not found in this club.");
  if (intent.id === "balance")
    return `Your total recorded amount owing is **R${s.summary.totalOwing}**.\n\n- Outstanding contributions: **R${s.summary.outstanding}**\n- Unpaid penalties: **R${s.summary.unsettledPenalties}**\n- Unbilled catch-up: **R${s.member.catchUpAmount}**\n\nStanding: **${plain(s.member.standing)}**.`;
  if (intent.id === "profile")
    return `Your recorded name is **${plain(s.member.fullName)}**. Your role is **${plain(s.member.role)}**, and your standing is **${plain(s.member.standing)}**. You joined on **${s.member.joinDate}**.`;
  const entries = s.lines.filter(
    (e) => e.entryType === "Contribution" || e.isReversal,
  );
  if (!entries.length)
    return "No contributions or corrections are recorded on your statement yet.";
  return (
    "Your latest contribution and correction entries (the full history is on your statement):\n\n" +
    entries
      .slice(-20)
      .map(
        (e) =>
          `- ${String(e.postedAt).slice(0, 10)}: ${plain(e.description)} — **R${e.amount}**`,
      )
      .join("\n")
  );
}
async function ask(db, question, intent, actor) {
  try {
    const text = await withClubTransaction(db.clubId, async (tx) => {
      await tx.query(
        "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
      );
      return answer(tx, intent, actor);
    });
    await log(
      db,
      question,
      intent.id,
      intent.id === "unrecognised" ? "Declined" : "Answered",
      actor,
    );
    return {
      answer: `${text}\n\n[Verify on the source screen](${intent.path})`,
      intent: intent.id,
      source: intent.path,
    };
  } catch (error) {
    await log(db, question, intent.id, "Failed", actor);
    throw error;
  }
}
function log(db, question, intent, outcome, actor) {
  return db.query(
    "INSERT INTO assistant_query(club_id,user_id,question_text,classified_intent,outcome) VALUES($1,$2,$3,$4,$5)",
    [db.clubId, actor.userId, question, intent, outcome],
  );
}
module.exports = { classify, ask };
