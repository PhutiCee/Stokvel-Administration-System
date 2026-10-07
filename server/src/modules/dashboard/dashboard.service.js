"use strict";
const repo = require("./dashboard.repo");
const { withClubTransaction } = require("../../db/tx");
const { toCents, toNumeric } = require("../../lib/money");
const { todayIso } = require("../../lib/dates");
const queue = require("../queue/queue.service");
const governance = require("../governance/governance.repo");
function total(rows, key = "amount") {
  return toNumeric(rows.reduce((n, r) => n + toCents(r[key]), 0));
}
function metric(key, label, rows, field = "amount", multiplier = 1) {
  return {
    key,
    label,
    value: field
      ? toNumeric(toCents(total(rows, field)) * multiplier)
      : rows.length,
    kind: field ? "money" : "count",
    records: rows,
  };
}
async function get(db, actor) {
  return withClubTransaction(db.clubId, async (tx, client) => {
    // All indicators and their embedded detail rows are one read-only snapshot.
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    const book = await repo.book(tx),
      officer = ["Treasurer", "Chairperson"].includes(actor.role);
    const ownBook = book.filter(
      (r) => r.member_id === actor.memberId && r.category === "Contribution",
    );
    const ownContributions = await repo.contributions(tx, actor.memberId),
      penalties = await repo.penalties(tx, actor.memberId);
    const indicators = [
      metric("paid", "My contributions paid to date", ownBook),
      metric(
        "outstanding",
        "My outstanding contributions",
        ownContributions.filter((r) => toCents(r.outstanding) > 0),
        "outstanding",
      ),
      metric("penalties", "My unpaid penalties", penalties, "outstanding"),
    ];
    const position = await queue.getOwnPosition(tx, { viewer: actor });
    const result = {
      asOf: new Date().toISOString(),
      position,
      poolBalance: total(book),
      indicators,
      months: [],
      limitations: [],
    };
    if (officer) {
      const month = todayIso().slice(0, 7),
        current = book.filter((r) => r.month === month);
      indicators.push(
        metric("pool", "Pool balance", book),
        metric(
          "income",
          "Income this month",
          current.filter((r) =>
            ["Contribution", "Penalty", "Interest"].includes(r.category),
          ),
        ),
        metric(
          "payouts",
          "Payouts and claims this month",
          current.filter((r) => ["Payout", "Claim"].includes(r.category)),
          "amount",
          -1,
        ),
        metric(
          "costs",
          "Administrative costs this month",
          current.filter((r) => r.category === "Expense"),
          "amount",
          -1,
        ),
        metric(
          "penaltyReceipts",
          "Penalty assessments less waivers this month (non-cash)",
          current.filter((r) => r.category === "Penalty"),
          "assessed_amount",
        ),
      );
      const contributions = await repo.contributions(tx, null);
      indicators.push(
        metric(
          "clubOutstanding",
          "Club outstanding contributions",
          contributions.filter((r) => toCents(r.outstanding) > 0),
          "outstanding",
        ),
      );
      const reconciliation = await repo.reconciliation(tx);
      indicators.push(
        metric(
          "reconciliation",
          "Latest reconciliation difference",
          reconciliation,
          "difference",
        ),
      );
      if (!reconciliation.length)
        indicators.find((m) => m.key === "reconciliation").value = null;
      result.reconciliationMissing = !reconciliation.length;
      result.reconciliationException = reconciliation.some(
        (r) => toCents(r.difference) !== 0 && !r.resolved,
      );
      indicators.push(
        metric(
          "overdue",
          "Rotation payouts overdue by more than 7 days",
          await repo.overdue(tx, todayIso()),
          null,
        ),
      );
      const [year, m] = month.split("-").map(Number);
      for (let i = 12; i >= 1; i--) {
        const d = new Date(Date.UTC(year, m - 1 - i, 1)),
          key = d.toISOString().slice(0, 7),
          rows = book.filter((r) => r.month === key);
        result.months.push({
          month: key,
          income: total(
            rows.filter((r) =>
              ["Contribution", "Penalty", "Interest"].includes(r.category),
            ),
          ),
          expenditure: toNumeric(
            -toCents(
              total(
                rows.filter((r) =>
                  ["Payout", "Claim", "Expense"].includes(r.category),
                ),
              ),
            ),
          ),
          records: rows,
        });
      }
      if (actor.role === "Chairperson") {
        indicators.push(
          metric(
            "approvals",
            "Payout approvals waiting",
            await repo.approvals(tx),
            null,
          ),
          metric("exits", "Exit notices waiting", await repo.exits(tx), null),
        );
        indicators.push(
          metric(
            "amendments",
            "Pending constitution proposals",
            (await governance.proposals(tx)).filter((r) =>
              ["Pending", "Carried"].includes(r.status),
            ),
            null,
          ),
        );
      }
      const standing=await require('../standing/standing.service').summary(tx);
      if(!standing.configured) result.limitations.push('Standing thresholds have not been adopted in the constitution. Automatic standing changes are paused.');
      if(actor.role==='Chairperson') {
        indicators.push(metric('warning','Members at warning stage',standing.members.filter(m=>m.standing==='In arrears'),null));
        indicators.push(metric('suspended','Members suspended',standing.members.filter(m=>m.standing==='Suspended'),null));
        indicators.push(metric('expulsionReview','Members requiring an expulsion resolution',standing.members.filter(m=>m.needsResolution),null));
      }
    }
    return result;
  });
}
module.exports = { get, total };
