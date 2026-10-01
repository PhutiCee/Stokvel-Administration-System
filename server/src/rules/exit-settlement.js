"use strict";
const { toCents, toNumeric } = require("../lib/money");
const { BadRequest, RuleRefusal } = require("../lib/errors");
function validatePolicy(p) {
  if (
    !p ||
    !["membership", "calendarYear", "constitutionStart"].includes(p.period) ||
    !/^\d{1,3}(\.\d{1,2})?$/.test(String(p.forfeitPercent)) ||
    toCents(String(p.forfeitPercent)) > 10000 ||
    ["deductPayouts", "deductPenalties", "deductCosts"].some(
      (k) => typeof p[k] !== "boolean",
    )
  )
    throw new BadRequest(
      "Specify the calculation period, percentage (0–100) and each deduction choice.",
    );
  return {
    period: p.period,
    forfeitPercent: toNumeric(toCents(String(p.forfeitPercent))),
    deductPayouts: p.deductPayouts,
    deductPenalties: p.deductPenalties,
    deductCosts: p.deductCosts,
  };
}
function compute(t, p) {
  if (
    ["contributions", "paid_out", "club_contributions", "costs"].some(
      (k) => toCents(t[k]) < 0,
    )
  )
    throw new RuleRefusal(
      "Net financial inputs are negative in the selected period. Review reversal timing before settlement.",
    );
  const contributions = toCents(t.contributions),
    paidOut = p.deductPayouts ? toCents(t.paid_out) : 0;
  const gross = Math.max(0, contributions - paidOut);
  const penalties = p.deductPenalties ? Math.max(0, toCents(t.penalties)) : 0;
  const clubContributions = toCents(t.club_contributions);
  const costs =
    p.deductCosts && clubContributions > 0
      ? Number(
          (BigInt(Math.max(0, toCents(t.costs))) *
            BigInt(Math.max(0, contributions))) /
            BigInt(clubContributions),
        )
      : 0;
  const afterDeductions = Math.max(0, gross - penalties - costs);
  const percentageForfeit = Number(
    (BigInt(afterDeductions) * BigInt(toCents(p.forfeitPercent))) / 10000n,
  );
  const repayable = afterDeductions - percentageForfeit;
  return {
    contributions: toNumeric(contributions),
    priorPayouts: toNumeric(paidOut),
    gross: toNumeric(gross),
    penaltyDeduction: toNumeric(Math.min(gross, penalties)),
    costDeduction: toNumeric(Math.min(Math.max(0, gross - penalties), costs)),
    percentageForfeit: toNumeric(percentageForfeit),
    forfeited: toNumeric(gross - repayable),
    repayable: toNumeric(repayable),
    outstanding: t.outstanding,
  };
}
module.exports = { validatePolicy, compute };
