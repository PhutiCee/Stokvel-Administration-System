"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateStanding, STANDING } = require("../src/rules/standing");

const T = { warningAfterMissed: 1, suspensionAfterMissed: 3, expulsionAfterMissed: 6 };
const base = {
    standing: "good",
    missedContributions: 0,
    arrearsCents: 0,
    penaltiesOutstandingCents: 0
};

test("good member with no arrears is unchanged", () => {
    assert.equal(evaluateStanding(base, T).changed, false);
});

test("reaching the warning threshold gives a warning", () => {
    const r = evaluateStanding({ ...base, missedContributions: 1, arrearsCents: 50000 }, T);
    assert.equal(r.standing, STANDING.WARNING);
});

test("advances one step at a time", () => {
    const r = evaluateStanding({ ...base, missedContributions: 7, arrearsCents: 50000 }, T);
    assert.equal(r.standing, STANDING.WARNING);
});

test("expulsion waits for a resolution", () => {
    const m = { ...base, standing: "suspended", missedContributions: 7, arrearsCents: 50000 };
    const r = evaluateStanding(m, T);
    assert.equal(r.changed, false);
    assert.equal(r.needsResolution, true);
    assert.equal(
        evaluateStanding({ ...m, expulsionApproved: true }, T).standing,
        STANDING.EXPELLED
    );
});

test("clearing arrears and penalties restores good standing with a date", () => {
    const now = new Date("2026-09-30");
    const r = evaluateStanding({ ...base, standing: "suspended" }, T, now);
    assert.equal(r.standing, STANDING.GOOD);
    assert.equal(r.changedAt, now);
});

test("an expelled member is never changed automatically", () => {
    const r = evaluateStanding({ ...base, standing: "expelled" }, T);
    assert.equal(r.changed, false);
});