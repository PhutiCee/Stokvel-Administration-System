"use strict";
const test = require("node:test"),
  assert = require("node:assert/strict");
const { validate } = require("../src/rules/beneficiaries");
const { compute, validatePolicy } = require("../src/rules/exit-settlement");
const policy = {
  period: "membership",
  forfeitPercent: "10.00",
  deductPayouts: true,
  deductPenalties: true,
  deductCosts: true,
};
test("beneficiary fractions total exactly 100 without floating point tolerance", () => {
  assert.equal(
    validate([
      { name: "A", relationship: "Parent", share: "33.33" },
      { name: "B", relationship: "Parent", share: "66.67" },
    ]).length,
    2,
  );
  assert.throws(() =>
    validate([{ name: "A", relationship: "Parent", share: "99.999" }]),
  );
  assert.throws(() =>
    validate([
      { name: "A", relationship: "Parent", share: "100" },
      { name: "B", relationship: "Parent", share: "0" },
    ]),
  );
});
test("exit deductions are capped and percentage is applied after deductions, rounded down to cents", () => {
  const result = compute(
    {
      contributions: "100.01",
      paid_out: "20.00",
      club_contributions: "300.03",
      costs: "10.00",
      penalties: "5.00",
      outstanding: "0.00",
    },
    policy,
  );
  assert.equal(result.costDeduction, "3.33");
  assert.equal(result.percentageForfeit, "7.16");
  assert.equal(result.repayable, "64.52");
  assert.equal(result.forfeited, "15.49");
  const capped = compute(
    {
      contributions: "1.00",
      paid_out: "0.00",
      club_contributions: "1.00",
      costs: "100.00",
      penalties: "2.00",
      outstanding: "0.00",
    },
    policy,
  );
  assert.equal(capped.repayable, "0.00");
  assert.equal(capped.penaltyDeduction, "1.00");
  assert.equal(capped.costDeduction, "0.00");
});
test("exit mapping rejects missing choices, invalid percentage and negative net period inputs", () => {
  assert.equal(validatePolicy(policy).forfeitPercent, "10.00");
  for (const bad of [
    { ...policy, period: "unknown" },
    { ...policy, forfeitPercent: "101" },
    { ...policy, deductCosts: "false" },
  ])
    assert.throws(() => validatePolicy(bad));
  assert.throws(() =>
    compute(
      {
        contributions: "-1.00",
        paid_out: "0.00",
        club_contributions: "1.00",
        costs: "0.00",
        penalties: "0.00",
        outstanding: "0.00",
      },
      policy,
    ),
  );
});
