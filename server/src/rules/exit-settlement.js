"use strict";
const { toCents, toNumeric } = require("../lib/money");
const { BadRequest, RuleRefusal } = require("../lib/errors");
function validatePolicy(p) {
  const allowed=['period','forfeitPercent','deductPayouts','deductPenalties','deductCosts','condition'];
  if(p && Object.keys(p).some(k=>!allowed.includes(k)))throw new BadRequest('Unsupported exit-rule setting. Every adopted condition must be explicitly represented.');
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
  let condition;
  if(p.condition != null) {
    const c=p.condition;
    if (Object.keys(c).some(k=>!["metric","threshold","evaluateAt","definition","afterPercent"].includes(k))) throw new BadRequest("Unsupported exit condition setting.");
    if(!['membershipDays','completedPaidCycles'].includes(c.metric) || !Number.isInteger(c.threshold) || c.threshold<1 || c.threshold>10000 || !['notice','settlement'].includes(c.evaluateAt) || typeof c.definition!=='string' || c.definition.trim().length<10 || c.definition.length>2000 || !/^\d{1,3}(\.\d{1,2})?$/.test(String(c.afterPercent)) || toCents(String(c.afterPercent))>10000)
      throw new BadRequest('Define the condition, positive threshold, assessment date, adopted meaning and percentage after the threshold.');
    condition={metric:c.metric,threshold:c.threshold,evaluateAt:c.evaluateAt,definition:c.definition.trim(),afterPercent:toNumeric(toCents(String(c.afterPercent)))};
  }
  return {
    ...(condition ? {condition} : {}),
    period: p.period,
    forfeitPercent: toNumeric(toCents(String(p.forfeitPercent))),
    deductPayouts: p.deductPayouts,
    deductPenalties: p.deductPenalties,
    deductCosts: p.deductCosts,
  };
}
function compute(t, p, facts = {}) {
  let percent=p.forfeitPercent;
  let conditionResult;
  if(p.condition){
    const c=p.condition,value=facts?.[c.metric];
    if(!Number.isInteger(value) || value<0 || !facts.evaluatedOn)throw new RuleRefusal('The conditional exit rule needs verified membership facts.');
    const reached=value>=c.threshold;
    percent=reached?c.afterPercent:p.forfeitPercent;
    conditionResult={metric:c.metric,threshold:c.threshold,actual:value,reached,evaluatedOn:facts.evaluatedOn,definition:c.definition};
  }
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
    (BigInt(afterDeductions) * BigInt(toCents(percent))) / 10000n,
  );
  const repayable = afterDeductions - percentageForfeit;
  return {
    ...(conditionResult ? {conditionResult,appliedForfeitPercent:percent} : {}),
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
