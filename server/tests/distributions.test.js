"use strict";

/**
 * Year-end distribution rules. REQ-79 to REQ-82.
 *
 * No database. src/rules/distributions.js decides the split and the
 * eligibility of a distribution from facts the caller supplies. Posting to the
 * ledger, dual authorisation and the database-level guards on the
 * `distribution` and `payout` tables (migration 012) are checked separately,
 * against a real PostgreSQL.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { allocateProportionally, computeShares, assessDistribution, describeDistributionRule } = require("../src/rules/distributions");
const { yearEndDateFor, nextYearEndAfter } = require("../src/lib/dates");

// ---------------------------------------------------------------------------
test("date helpers behind REQ-79", async (t) => {
    await t.test("yearEndDateFor builds the date for a given year", () => {
        assert.equal(yearEndDateFor(2026, 11, 30), "2026-11-30");
        assert.equal(yearEndDateFor(2026, 1, 5), "2026-01-05");
    });

    await t.test("yearEndDateFor clamps a day that does not exist in that month", () => {
        assert.equal(yearEndDateFor(2026, 2, 31), "2026-02-28");
        assert.equal(yearEndDateFor(2028, 2, 31), "2028-02-29"); // leap year
        assert.equal(yearEndDateFor(2026, 4, 31), "2026-04-30");
    });

    await t.test("nextYearEndAfter finds the next occurrence strictly after a date", () => {
        assert.equal(nextYearEndAfter("2025-11-30", 11, 30), "2026-11-30");
        assert.equal(nextYearEndAfter("2025-11-29", 11, 30), "2025-11-30");
        assert.equal(nextYearEndAfter("2025-12-01", 11, 30), "2026-11-30");
    });

    await t.test("nextYearEndAfter after a club's registration date lands correctly across a year boundary", () => {
        assert.equal(nextYearEndAfter("2026-01-01", 11, 30), "2026-11-30");
        assert.equal(nextYearEndAfter("2026-12-01", 1, 15), "2027-01-15");
    });
});

// ---------------------------------------------------------------------------
test("allocateProportionally — REQ-81, exact reconciliation", async (t) => {
    await t.test("splits exactly, with no cent left over or invented", () => {
        for (const [total, weights] of [[100, [1, 1, 1]], [10001, [3, 5, 7]], [1, [1, 1, 1, 1, 1, 1, 1]], [999999, [1]]]) {
            const r = allocateProportionally(total, weights);
            assert.equal(r.reduce((a, b) => a + b, 0), total, `total=${total} weights=${weights}`);
            assert.equal(r.length, weights.length);
        }
    });

    await t.test("a weight of zero gets nothing", () => {
        const r = allocateProportionally(100, [1, 0, 1]);
        assert.equal(r[1], 0);
        assert.equal(r[0] + r[2], 100);
    });

    await t.test("proportional split is respected before rounding", () => {
        const r = allocateProportionally(1000, [1, 3]); // 250 / 750 exactly
        assert.deepEqual(r, [250, 750]);
    });

    await t.test("zero total distributes zero to everyone, even with positive weights", () => {
        assert.deepEqual(allocateProportionally(0, [1, 2, 3]), [0, 0, 0]);
    });

    await t.test("all-zero weights with a zero total is fine", () => {
        assert.deepEqual(allocateProportionally(0, [0, 0]), [0, 0]);
    });

    await t.test("all-zero weights with a nonzero total has no basis to split by", () => {
        assert.equal(allocateProportionally(100, [0, 0]), null);
    });

    await t.test("an empty list of weights returns an empty split", () => {
        assert.deepEqual(allocateProportionally(0, []), []);
    });

    await t.test("negative totals or weights are refused, not silently coerced", () => {
        assert.throws(() => allocateProportionally(-1, [1]), TypeError);
        assert.throws(() => allocateProportionally(1, [-1]), TypeError);
        assert.throws(() => allocateProportionally(1.5, [1]), TypeError);
    });

    await t.test("the largest remainder gets the leftover cent, ties broken by position", () => {
        // 10 split 1:1:1 -> 3.33 each: floors 3,3,3 sum 9, one cent left over,
        // remainders are exactly tied, so the first index wins.
        assert.deepEqual(allocateProportionally(10, [1, 1, 1]), [4, 3, 3]);
    });
});

// ---------------------------------------------------------------------------
test("computeShares — REQ-80's formula", async (t) => {
    const members = (rows) => rows.map(([memberId, capturedCents, penaltyCents]) => ({ memberId, fullName: memberId, capturedCents, penaltyCents }));

    await t.test("with no interest and no expenses, each member simply nets their own contributions less penalties", () => {
        const r = computeShares({ members: members([["a", 10000, 2000], ["b", 5000, 0]]), interestCents: 0, expenseCents: 0 });
        assert.equal(r.ok, true);
        assert.equal(r.perMember[0].finalCents, 8000);
        assert.equal(r.perMember[1].finalCents, 5000);
        assert.equal(r.totalFinalCents, 13000);
    });

    await t.test("interest and costs are shared in proportion to net contribution, and reconcile exactly", () => {
        const r = computeShares({ members: members([["a", 20000, 0], ["b", 10000, 0]]), interestCents: 300, expenseCents: 150 });
        assert.equal(r.ok, true);
        assert.equal(r.perMember[0].interestShareCents, 200); // 2/3 of 300
        assert.equal(r.perMember[1].interestShareCents, 100);
        assert.equal(r.perMember[0].expenseShareCents, 100);  // 2/3 of 150
        assert.equal(r.perMember[1].expenseShareCents, 50);
        assert.equal(r.totalFinalCents, 20000 - 0 + 200 - 100 + (10000 - 0 + 100 - 50));
        assert.equal(r.totalFinalCents, 30150);
    });

    await t.test("a member whose penalties exceed their contributions has zero weight, not a negative one, for allocation purposes", () => {
        const r = computeShares({ members: members([["a", 5000, 8000], ["b", 10000, 0]]), interestCents: 100, expenseCents: 0 });
        assert.equal(r.ok, true);
        assert.equal(r.perMember[0].interestShareCents, 0); // weight floored at zero
        assert.equal(r.perMember[1].interestShareCents, 100);
        // Their own base is still negative — the eligibility check catches this, computeShares just reports it.
        assert.equal(r.perMember[0].finalCents, -3000);
    });

    await t.test("nothing captured and nothing owed nets to zero for everyone, with no interest or costs to place", () => {
        const r = computeShares({ members: members([["a", 0, 0], ["b", 0, 0]]), interestCents: 0, expenseCents: 0 });
        assert.equal(r.ok, true);
        assert.deepEqual(r.perMember.map((m) => m.finalCents), [0, 0]);
    });

    await t.test("interest or costs with no member holding a positive net contribution has no basis to split by", () => {
        const r = computeShares({ members: members([["a", 0, 500]]), interestCents: 50, expenseCents: 0 });
        assert.equal(r.ok, false);
        assert.match(r.reason, /no basis/);
    });

    await t.test("a single member receives the whole of everything", () => {
        const r = computeShares({ members: members([["a", 10000, 0]]), interestCents: 77, expenseCents: 33 });
        assert.equal(r.perMember[0].interestShareCents, 77);
        assert.equal(r.perMember[0].expenseShareCents, 33);
    });
});

// ---------------------------------------------------------------------------
test("assessDistribution — REQ-79, REQ-80, REQ-81 together", async (t) => {
    const goodMembers = [
        { memberId: "a", fullName: "A", standing: "Good standing", capturedCents: 10000, penaltyCents: 0 },
        { memberId: "b", fullName: "B", standing: "Good standing", capturedCents: 5000, penaltyCents: 0 }
    ];
    const base = (over = {}) => ({
        clubType: "Accumulating", yearEndDate: "2026-11-30", isDue: true, alreadyDistributed: false,
        members: goodMembers, interestCents: 0, expenseCents: 0, poolCents: 15000, ...over
    });

    await t.test("eligible when the shares sum exactly to the pool", () => {
        const r = assessDistribution(base());
        assert.equal(r.eligible, true, JSON.stringify(r.refusals));
        assert.equal(r.shares.totalFinalCents, 15000);
    });

    await t.test("REQ-79: only an accumulating club", () => {
        const r = assessDistribution(base({ clubType: "Rotating" }));
        assert.ok(r.refusals.some((x) => x.code === "NOT_ACCUMULATING"));
    });

    await t.test("REQ-79: no year-end date named in the constitution", () => {
        const r = assessDistribution(base({ yearEndDate: null, isDue: false }));
        assert.ok(r.refusals.some((x) => x.code === "NO_YEAR_END_DATE"));
    });

    await t.test("REQ-79: not yet due", () => {
        const r = assessDistribution(base({ isDue: false }));
        assert.ok(r.refusals.some((x) => x.code === "NOT_YET_DUE"));
        assert.match(r.refusals.find((x) => x.code === "NOT_YET_DUE").message, /2026-11-30/);
    });

    await t.test("already distributed for this year-end date", () => {
        const r = assessDistribution(base({ alreadyDistributed: true }));
        assert.ok(r.refusals.some((x) => x.code === "ALREADY_DISTRIBUTED"));
    });

    await t.test("no members to distribute to", () => {
        const r = assessDistribution(base({ members: [] }));
        assert.ok(r.refusals.some((x) => x.code === "NO_MEMBERS"));
        assert.equal(r.shares, null);
    });

    await t.test("REQ-81: the pool must match exactly, not approximately", () => {
        const r = assessDistribution(base({ poolCents: 15001 }));
        assert.ok(r.refusals.some((x) => x.code === "POOL_MISMATCH"));
        assert.match(r.refusals.find((x) => x.code === "POOL_MISMATCH").message, /15000.*15001|15001.*15000/s);
    });

    await t.test("a negative computed share is refused rather than silently zeroed", () => {
        const withDebtor = [...goodMembers, { memberId: "c", fullName: "C", standing: "Good standing", capturedCents: 1000, penaltyCents: 4000 }];
        const r = assessDistribution(base({ members: withDebtor, poolCents: 12000 }));
        assert.ok(r.refusals.some((x) => x.code === "NEGATIVE_SHARE"));
        assert.match(r.refusals.find((x) => x.code === "NEGATIVE_SHARE").message, /C/);
    });

    await t.test("every applicable reason is reported at once", () => {
        const r = assessDistribution(base({ clubType: "Rotating", isDue: false, members: [] }));
        assert.deepEqual(new Set(r.refusals.map((x) => x.code)), new Set(["NOT_ACCUMULATING", "NOT_YET_DUE", "NO_MEMBERS"]));
    });
});

// ---------------------------------------------------------------------------
test("describeDistributionRule — REQ-82: the rule as recorded and shown", async (t) => {
    await t.test("names the constitution version and the year-end date", () => {
        const text = describeDistributionRule({ constitutionVersion: 2, yearEndDate: "2026-11-30" });
        assert.match(text, /version 2/);
        assert.match(text, /2026-11-30/);
    });
});