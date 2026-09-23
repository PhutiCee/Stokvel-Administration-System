"use strict";

/**
 * Payout eligibility rules. REQ-65 to REQ-68, REQ-72, REQ-77.
 *
 * No database. src/rules/payouts.js decides whether a rotation payout may go
 * ahead from facts the caller supplies; this file supplies every combination
 * of facts that matters. Dual authorisation (REQ-64), posting to the ledger and
 * advancing the queue (REQ-73) all touch the database and are checked
 * separately, against a real PostgreSQL.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { assessRotationPayout, describeRotationRule } = require("../src/rules/payouts");
const { toCents } = require("../src/lib/money");

const member = (over = {}) => ({ memberId: "m-1", fullName: "Palesa Dube", standing: "Good standing", position: 1, ...over });
const cycle = (over = {}) => ({ dueDate: "2026-09-01", sequenceNumber: 6, ...over });

const baseFacts = (over = {}) => ({
    clubType: "Rotating",
    recipient: member(),
    head: { memberId: "m-1", fullName: "Palesa Dube" },
    amountCents: toCents("4400.00"),
    poolCents: toCents("4400.00"),
    cycle: cycle(),
    today: "2026-09-20",
    arrearsRuling: null,
    ...over
});

const codes = (r) => r.refusals.map((x) => x.code);

// ---------------------------------------------------------------------------
test("assessRotationPayout — the happy path", async (t) => {
    await t.test("eligible when every condition holds", () => {
        const r = assessRotationPayout(baseFacts());
        assert.equal(r.eligible, true);
        assert.deepEqual(r.refusals, []);
        assert.equal(r.chairpersonOptions, null);
    });
});

// ---------------------------------------------------------------------------
test("REQ-71 — only a Rotating club uses this at all", async (t) => {
    await t.test("Accumulating and Burial clubs are refused", () => {
        assert.ok(codes(assessRotationPayout(baseFacts({ clubType: "Accumulating" }))).includes("NOT_ROTATING"));
        assert.ok(codes(assessRotationPayout(baseFacts({ clubType: "Burial" }))).includes("NOT_ROTATING"));
    });
});

// ---------------------------------------------------------------------------
test("REQ-72 — only the member at the head of the queue", async (t) => {
    await t.test("the member at the head is eligible", () => {
        const r = assessRotationPayout(baseFacts());
        assert.equal(r.eligible, true);
    });

    await t.test("a member not at the head is refused", () => {
        const r = assessRotationPayout(baseFacts({ recipient: member({ memberId: "m-2", fullName: "Someone Else", position: 3 }) }));
        assert.ok(codes(r).includes("NOT_AT_HEAD"));
        assert.match(r.refusals.find((x) => x.code === "NOT_AT_HEAD").message, /Someone Else/);
    });

    await t.test("an empty queue is refused with no member to blame", () => {
        const r = assessRotationPayout(baseFacts({ head: null, recipient: null }));
        assert.ok(codes(r).includes("EMPTY_QUEUE"));
    });

    await t.test("no cycle waiting to be paid out is refused", () => {
        const r = assessRotationPayout(baseFacts({ cycle: null, amountCents: 0 }));
        assert.ok(codes(r).includes("NO_CYCLE_TO_PAY"));
    });

    await t.test("a cycle still collecting (due date not yet passed) is refused", () => {
        const r = assessRotationPayout(baseFacts({ cycle: cycle({ dueDate: "2026-09-25" }), today: "2026-09-20" }));
        assert.ok(codes(r).includes("CYCLE_STILL_COLLECTING"));
    });

    await t.test("a cycle due exactly today has not yet \"passed\" its due date and is still refused", () => {
        const r = assessRotationPayout(baseFacts({ cycle: cycle({ dueDate: "2026-09-20" }), today: "2026-09-20" }));
        assert.ok(codes(r).includes("CYCLE_STILL_COLLECTING"));
    });

    await t.test("the day after the due date, the cycle may be paid out", () => {
        const r = assessRotationPayout(baseFacts({ cycle: cycle({ dueDate: "2026-09-19" }), today: "2026-09-20" }));
        assert.equal(codes(r).includes("CYCLE_STILL_COLLECTING"), false);
    });
});

// ---------------------------------------------------------------------------
test("REQ-67, REQ-77 — standing of the recipient", async (t) => {
    await t.test("Suspended is refused outright, no payment possible", () => {
        const r = assessRotationPayout(baseFacts({ recipient: member({ standing: "Suspended" }) }));
        assert.ok(codes(r).includes("SUSPENDED"));
        assert.deepEqual(r.chairpersonOptions, ["defer"]);
    });

    await t.test("Expelled and Exited are refused, with no options offered — there is no ruling to make", () => {
        for (const s of ["Expelled", "Exited"]) {
            const r = assessRotationPayout(baseFacts({ recipient: member({ standing: s }) }));
            assert.ok(codes(r).includes("NOT_A_MEMBER"), s);
            assert.equal(r.chairpersonOptions, null, s);
        }
    });

    await t.test("In arrears with no ruling is refused, offering both options", () => {
        const r = assessRotationPayout(baseFacts({ recipient: member({ standing: "In arrears" }) }));
        assert.ok(codes(r).includes("IN_ARREARS"));
        assert.deepEqual(r.chairpersonOptions, ["defer", "pay"]);
    });

    await t.test("In arrears WITH a usable ruling to pay is not refused on standing", () => {
        const r = assessRotationPayout(baseFacts({
            recipient: member({ standing: "In arrears" }),
            arrearsRuling: { decisionId: "d-1" }
        }));
        assert.equal(codes(r).includes("IN_ARREARS"), false);
        assert.equal(r.eligible, true);
        assert.ok(r.notes.some((n) => /notwithstanding/.test(n)));
    });

    await t.test("Good standing needs no ruling and gets none", () => {
        const r = assessRotationPayout(baseFacts());
        assert.equal(r.chairpersonOptions, null);
        assert.deepEqual(r.notes, []);
    });
});

// ---------------------------------------------------------------------------
test("REQ-66 — the amount against the pool", async (t) => {
    await t.test("an amount exactly equal to the pool is allowed", () => {
        const r = assessRotationPayout(baseFacts({ amountCents: 440000, poolCents: 440000 }));
        assert.equal(codes(r).includes("EXCEEDS_POOL"), false);
    });

    await t.test("an amount one cent over the pool is refused, and states the shortfall", () => {
        const r = assessRotationPayout(baseFacts({ amountCents: 440001, poolCents: 440000 }));
        assert.ok(codes(r).includes("EXCEEDS_POOL"));
        assert.match(r.refusals.find((x) => x.code === "EXCEEDS_POOL").message, /R0\.01 short/);
    });

    await t.test("zero or negative captured contributions leave nothing to pay", () => {
        assert.ok(codes(assessRotationPayout(baseFacts({ amountCents: 0 }))).includes("NOTHING_TO_PAY"));
        assert.ok(codes(assessRotationPayout(baseFacts({ amountCents: -100 }))).includes("NOTHING_TO_PAY"));
    });
});

// ---------------------------------------------------------------------------
test("every reason is reported at once, not just the first", async (t) => {
    await t.test("a member who is both not at the head and suspended, with an amount over the pool, gets all three refusals", () => {
        const r = assessRotationPayout(baseFacts({
            recipient: member({ memberId: "m-2", fullName: "Someone Else", standing: "Suspended", position: 4 }),
            amountCents: 999999, poolCents: 100
        }));
        assert.equal(r.eligible, false);
        assert.deepEqual(new Set(codes(r)), new Set(["NOT_AT_HEAD", "SUSPENDED", "EXCEEDS_POOL"]));
    });
});

// ---------------------------------------------------------------------------
test("describeRotationRule — REQ-65, REQ-68: the rule as recorded and shown", async (t) => {
    await t.test("names the constitution version, the payout order method and the cycle", () => {
        const text = describeRotationRule({ constitutionVersion: 3, payoutOrderMethod: "Seniority", cycleSequence: 7 });
        assert.match(text, /version 3/);
        assert.match(text, /Seniority/);
        assert.match(text, /cycle 7/);
    });

    await t.test("a missing payout order method is stated plainly rather than left blank", () => {
        const text = describeRotationRule({ constitutionVersion: 1, payoutOrderMethod: null, cycleSequence: 1 });
        assert.match(text, /not stated/);
    });
});