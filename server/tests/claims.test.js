"use strict";

/**
 * Burial claim rules. REQ-83 to REQ-88.
 *
 * No database. src/rules/claims.js decides whether a claim may be LODGED
 * (REQ-84, REQ-85, REQ-87) and whether it may be PAID (REQ-67, REQ-88) from
 * facts the caller supplies. Dual authorisation, the database-level guards on
 * `burial_claim` (migration 013) and posting to the ledger are checked
 * separately, against a real PostgreSQL.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { resolveBenefitAmount, assessLodgement, assessClaimPayment } = require("../src/rules/claims");

const schedule = [
    { category: "Principal member", amount: "10000.00" },
    { category: "Spouse", amount: "8000.00" },
    { category: "Child under 21", amount: "5000.00" }
];

// ---------------------------------------------------------------------------
test("resolveBenefitAmount — REQ-86", async (t) => {
    await t.test("finds the amount for a category, in cents", () => {
        const r = resolveBenefitAmount(schedule, "Spouse");
        assert.equal(r.ok, true);
        assert.equal(r.amountCents, 800000);
    });

    await t.test("matching is case- and whitespace-insensitive", () => {
        assert.equal(resolveBenefitAmount(schedule, "  spouse  ").ok, true);
        assert.equal(resolveBenefitAmount(schedule, "SPOUSE").amountCents, 800000);
    });

    await t.test("a category not in the schedule is refused, not defaulted", () => {
        const r = resolveBenefitAmount(schedule, "Grandparent");
        assert.equal(r.ok, false);
        assert.match(r.reason, /Grandparent/);
    });

    await t.test("an empty schedule refuses everything", () => {
        assert.equal(resolveBenefitAmount([], "Spouse").ok, false);
        assert.equal(resolveBenefitAmount(null, "Spouse").ok, false);
    });
});

// ---------------------------------------------------------------------------
test("assessLodgement — REQ-84, REQ-85, REQ-87, BR-11", async (t) => {
    const dependant = (over = {}) => ({ memberId: "m-1", category: "Spouse", registeredAt: "2020-01-01", removedAt: null, ...over });
    const base = (over = {}) => ({
        clubType: "Burial", claimantStanding: "Good standing", dependant: dependant(),
        claimantMemberId: "m-1", dateOfDeath: "2026-09-01", today: "2026-09-10",
        memberJoinDate: "2019-01-01", waitingPeriodDays: 180, alreadyClaimed: false, ...over
    });

    await t.test("eligible when every condition holds", () => {
        const r = assessLodgement(base());
        assert.equal(r.eligible, true, JSON.stringify(r.refusals));
    });

    await t.test("REQ-84: the claimant must be in good standing", () => {
        for (const s of ["Suspended", "Expelled", "In arrears"]) {
            const r = assessLodgement(base({ claimantStanding: s }));
            assert.ok(r.refusals.some((x) => x.code === "CLAIMANT_NOT_ELIGIBLE"), s);
        }
    });

    await t.test("REQ-85: no such dependant on record", () => {
        const r = assessLodgement(base({ dependant: null }));
        assert.ok(r.refusals.some((x) => x.code === "NOT_A_DEPENDANT"));
    });

    await t.test("REQ-85: the dependant belongs to a different member", () => {
        const r = assessLodgement(base({ dependant: dependant({ memberId: "someone-else" }) }));
        assert.ok(r.refusals.some((x) => x.code === "NOT_YOUR_DEPENDANT"));
    });

    await t.test("REQ-85, BR-11: recorded AFTER the death is not covered", () => {
        const r = assessLodgement(base({ dependant: dependant({ registeredAt: "2026-09-02" }) }));
        assert.ok(r.refusals.some((x) => x.code === "NOT_COVERED_BEFORE_DEATH"));
    });

    await t.test("recorded on the same day as the death IS covered — not strictly before", () => {
        const r = assessLodgement(base({ dependant: dependant({ registeredAt: "2026-09-01" }) }));
        assert.equal(r.refusals.some((x) => x.code === "NOT_COVERED_BEFORE_DEATH"), false);
    });

    await t.test("cover that ended before the death is refused", () => {
        const r = assessLodgement(base({ dependant: dependant({ removedAt: "2026-08-01" }) }));
        assert.ok(r.refusals.some((x) => x.code === "COVER_ALREADY_ENDED"));
    });

    await t.test("cover ending AFTER the death does not block the claim", () => {
        const r = assessLodgement(base({ dependant: dependant({ removedAt: "2026-10-01" }) }));
        assert.equal(r.refusals.some((x) => x.code === "COVER_ALREADY_ENDED"), false);
    });

    await t.test("a dependant already claimed is refused", () => {
        const r = assessLodgement(base({ alreadyClaimed: true }));
        assert.ok(r.refusals.some((x) => x.code === "ALREADY_CLAIMED"));
    });

    await t.test("REQ-87: the waiting period is measured from the member's admission to the LODGING date, not the death date", () => {
        // Joined 2026-08-01, 180-day wait -> eligible to lodge from 2027-01-28.
        // Death occurs immediately, but lodging today (still within the wait) is refused.
        const r = assessLodgement(base({ memberJoinDate: "2026-08-01", dateOfDeath: "2026-09-01", today: "2026-09-05", waitingPeriodDays: 180 }));
        assert.ok(r.refusals.some((x) => x.code === "WAITING_PERIOD"));
        assert.match(r.refusals.find((x) => x.code === "WAITING_PERIOD").message, /2027-01-28/);
    });

    await t.test("lodging on the first eligible date is allowed", () => {
        const r = assessLodgement(base({ memberJoinDate: "2026-08-01", today: "2027-01-28", waitingPeriodDays: 180 }));
        assert.equal(r.refusals.some((x) => x.code === "WAITING_PERIOD"), false);
    });

    await t.test("a zero waiting period never blocks lodging", () => {
        const r = assessLodgement(base({ memberJoinDate: "2026-09-09", today: "2026-09-10", waitingPeriodDays: 0 }));
        assert.equal(r.refusals.some((x) => x.code === "WAITING_PERIOD"), false);
    });

    await t.test("a future date of death is refused", () => {
        const r = assessLodgement(base({ dateOfDeath: "2026-09-20", today: "2026-09-10" }));
        assert.ok(r.refusals.some((x) => x.code === "FUTURE_DATE"));
    });

    await t.test("a malformed date of death is refused, not silently accepted", () => {
        const r = assessLodgement(base({ dateOfDeath: "not-a-date" }));
        assert.ok(r.refusals.some((x) => x.code === "BAD_DATE"));
    });

    await t.test("every applicable reason is reported at once", () => {
        const r = assessLodgement(base({ claimantStanding: "Suspended", dependant: null, memberJoinDate: "2026-09-09", today: "2026-09-10", waitingPeriodDays: 180 }));
        assert.deepEqual(new Set(r.refusals.map((x) => x.code)), new Set(["CLAIMANT_NOT_ELIGIBLE", "NOT_A_DEPENDANT", "WAITING_PERIOD"]));
    });

    await t.test("only a burial society assesses claims this way", () => {
        const r = assessLodgement(base({ clubType: "Rotating" }));
        assert.ok(r.refusals.some((x) => x.code === "NOT_BURIAL"));
    });
});

// ---------------------------------------------------------------------------
test("assessClaimPayment — REQ-67, REQ-88, BR-12", async (t) => {
    const base = (over = {}) => ({
        claimantStanding: "Good standing", benefitCents: 800000, poolCents: 1000000,
        isOldestUnresolved: true, oldestLodgedAt: null, ...over
    });

    await t.test("eligible when standing, order and the pool all hold", () => {
        assert.equal(assessClaimPayment(base()).eligible, true);
    });

    await t.test("REQ-67: a suspended or expelled claimant cannot be paid", () => {
        for (const s of ["Suspended", "Expelled"]) {
            const r = assessClaimPayment(base({ claimantStanding: s }));
            assert.ok(r.refusals.some((x) => x.code === "CLAIMANT_NOT_ELIGIBLE"), s);
        }
    });

    await t.test("REQ-67: a claimant in arrears is NOT blocked — REQ-77's arrears rule is rotation-only", () => {
        const r = assessClaimPayment(base({ claimantStanding: "In arrears" }));
        assert.equal(r.refusals.some((x) => x.code === "CLAIMANT_NOT_ELIGIBLE"), false);
    });

    await t.test("REQ-88: a claim that is not the oldest unresolved one is refused, naming when the true oldest was lodged", () => {
        const r = assessClaimPayment(base({ isOldestUnresolved: false, oldestLodgedAt: "2026-05-01" }));
        assert.ok(r.refusals.some((x) => x.code === "OUT_OF_ORDER"));
        assert.match(r.refusals.find((x) => x.code === "OUT_OF_ORDER").message, /2026-05-01/);
    });

    await t.test("BR-12: the benefit exceeding the pool is refused outright, never part-paid", () => {
        const r = assessClaimPayment(base({ benefitCents: 1000001, poolCents: 1000000 }));
        assert.ok(r.refusals.some((x) => x.code === "INSUFFICIENT_POOL"));
    });

    await t.test("a benefit exactly equal to the pool is payable", () => {
        assert.equal(assessClaimPayment(base({ benefitCents: 1000000, poolCents: 1000000 })).eligible, true);
    });

    await t.test("every applicable reason is reported at once", () => {
        const r = assessClaimPayment(base({ claimantStanding: "Expelled", isOldestUnresolved: false, oldestLodgedAt: "2026-01-01", benefitCents: 2000000 }));
        assert.deepEqual(new Set(r.refusals.map((x) => x.code)), new Set(["CLAIMANT_NOT_ELIGIBLE", "OUT_OF_ORDER", "INSUFFICIENT_POOL"]));
    });
});