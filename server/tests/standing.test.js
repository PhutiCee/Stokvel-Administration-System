"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { evaluateStanding, STANDING } = require("../src/rules/standing");

const T = { warningAfterMissed: 1, suspensionAfterMissed: 3, expulsionAfterMissed: 6 };
const TODAY = "2026-09-30";
const base = {
    standing: STANDING.GOOD,
    missedContributions: 0,
    arrearsCents: 0,
    penaltiesOutstandingCents: 0
};

test("good member with no arrears is unchanged", () => {
    assert.equal(evaluateStanding(base, T, TODAY).changed, false);
});

test("reaching the warning threshold moves a member to In arrears", () => {
    const r = evaluateStanding({ ...base, missedContributions: 1, arrearsCents: 50000 }, T, TODAY);
    assert.equal(r.standing, STANDING.WARNING);
    assert.equal(r.action, "issue_warning");
});

test("advances one step at a time", () => {
    const r = evaluateStanding({ ...base, missedContributions: 7, arrearsCents: 50000 }, T, TODAY);
    assert.equal(r.standing, STANDING.WARNING);
});

test("suspension follows the warning stage", () => {
    const m = { ...base, standing: STANDING.WARNING, missedContributions: 3, arrearsCents: 50000 };
    assert.equal(evaluateStanding(m, T, TODAY).standing, STANDING.SUSPENDED);
});

test("expulsion waits for a resolution", () => {
    const m = { ...base, standing: STANDING.SUSPENDED, missedContributions: 7, arrearsCents: 50000 };
    const r = evaluateStanding(m, T, TODAY);
    assert.equal(r.changed, false);
    assert.equal(r.needsResolution, true);
    assert.equal(
        evaluateStanding({ ...m, expulsionApproved: true }, T, TODAY).standing,
        STANDING.EXPELLED
    );
});

test("clearing arrears and penalties restores Good standing with the date", () => {
    const r = evaluateStanding({ ...base, standing: STANDING.SUSPENDED }, T, TODAY);
    assert.equal(r.standing, STANDING.GOOD);
    assert.equal(r.changedOn, TODAY);
});

test("an outstanding penalty alone keeps a member from returning to Good standing", () => {
    const m = { ...base, standing: STANDING.WARNING, missedContributions: 1, penaltiesOutstandingCents: 5000 };
    assert.equal(evaluateStanding(m, T, TODAY).changed, false);
});

test("an expelled member is never changed automatically", () => {
    assert.equal(evaluateStanding({ ...base, standing: STANDING.EXPELLED }, T, TODAY).changed, false);
});

test("an exited member is never changed", () => {
    assert.equal(evaluateStanding({ ...base, standing: STANDING.EXITED }, T, TODAY).changed, false);
});
