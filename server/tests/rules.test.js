"use strict";

/**
 * Rules engine tests.
 *
 * These require NO DATABASE and no network. They exercise the pure functions in
 * src/rules and src/lib, which is where every decision the system makes about
 * money actually lives.
 *
 * That matters on demonstration day: if the database is unreachable, these
 * still run and still prove the rules are right.
 *
 * Each test names the requirement it covers, so this file doubles as the
 * evidence column of docs/traceability.md.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { can, refusalReason, MATRIX } = require("../src/rules/permissions");
const {
    resolveStatus, checkCaptureAmount, checkMethod, lateFrom, penaltyIsDue
} = require("../src/rules/contributions");
const { validateConsistency, cycleLengthDays } = require("../src/rules/constitution");
const { toCents, toNumeric, format, sum } = require("../src/lib/money");

// ---------------------------------------------------------------------------
test("money — REQ-93: fixed-precision arithmetic", async (t) => {

    await t.test("the float trap the requirement exists to avoid", () => {
        // 0.1 + 0.2 !== 0.3 in binary floating point. In cents it is exact.
        assert.equal(sum("0.10", "0.20"), 30);
        assert.equal(toNumeric(sum("0.10", "0.20")), "0.30");
    });

    await t.test("parses the forms the database and the user produce", () => {
        assert.equal(toCents("500.00"), 50000);
        assert.equal(toCents("500"), 50000);
        assert.equal(toCents(500), 50000);
        assert.equal(toCents("R500.00"), 50000);
        assert.equal(toCents("-1200.50"), -120050);
        assert.equal(toCents(null), 0);
    });

    await t.test("rejects what is not an amount", () => {
        assert.throws(() => toCents("abc"));
        assert.throws(() => toCents("12.34.56"));
        assert.throws(() => toCents(Infinity));
    });

    await t.test("round-trips without drift over many operations", () => {
        let cents = 0;
        for (let i = 0; i < 1000; i++) cents += toCents("0.07");
        assert.equal(toNumeric(cents), "70.00");
    });

    await t.test("formats for reading", () => {
        assert.equal(format(toCents("1234567.89")), "R1\u2009234\u2009567.89");
        assert.equal(format(toCents("-500")), "\u2212R500.00");
    });
});

// ---------------------------------------------------------------------------
test("permissions — REQ-7, REQ-8, REQ-43, BR-10", async (t) => {

    await t.test("only the Treasurer captures a contribution", () => {
        assert.equal(can("Treasurer", "contribution.capture"), true);
        assert.equal(can("Chairperson", "contribution.capture"), false);
        assert.equal(can("Secretary", "contribution.capture"), false);
        assert.equal(can("Member", "contribution.capture"), false);
    });

    await t.test("REQ-64: initiation and approval are held by different roles", () => {
        assert.equal(can("Treasurer", "payout.initiate"), true);
        assert.equal(can("Treasurer", "payout.approve"), false);
        assert.equal(can("Chairperson", "payout.approve"), true);
        assert.equal(can("Chairperson", "payout.initiate"), false);
    });

    await t.test("REQ-43: the Secretary AND the Chairperson may register and amend", () => {
        for (const action of ["member.register", "member.amend", "member.assignRole"]) {
            assert.equal(can("Secretary", action), true, `Secretary should hold ${action}`);
            assert.equal(can("Chairperson", action), true, `Chairperson should hold ${action}`);
        }
    });

    await t.test("BR-10: the Platform Administrator holds no club permission", () => {
        const clubActions = [...new Set(
            Object.entries(MATRIX)
                .filter(([role]) => role !== "PlatformAdmin")
                .flatMap(([, actions]) => actions)
        )];
        for (const action of clubActions) {
            assert.equal(can("PlatformAdmin", action), false,
                `PlatformAdmin must not hold ${action}`);
        }
    });

    await t.test("every member may read their own statement and the pool", () => {
        for (const role of ["Member", "Treasurer", "Secretary", "Chairperson"]) {
            assert.equal(can(role, "view.ownStatement"), true);
            assert.equal(can(role, "view.pool"), true);
        }
    });

    await t.test("an ordinary member cannot read the whole ledger", () => {
        assert.equal(can("Member", "view.ledger"), false);
    });

    await t.test("no role at all grants nothing", () => {
        assert.equal(can(null, "view.dashboard"), false);
        assert.equal(can("NotARole", "view.dashboard"), false);
    });

    await t.test("a refusal names the role that could do it", () => {
        const reason = refusalReason("Member", "contribution.capture");
        assert.match(reason, /Member/);
        assert.match(reason, /Treasurer/);
    });
});

// ---------------------------------------------------------------------------
test("contribution status — REQ-54, REQ-55", async (t) => {
    const due = "2026-09-07";
    const at = (d) => new Date(d);

    await t.test("paid in full is Paid, however late", () => {
        assert.equal(resolveStatus({
            expected: "500.00", captured: "500.00", dueDate: due, graceDays: 5, asAt: at("2026-12-25")
        }), "Paid");
    });

    await t.test("overpayment is Paid", () => {
        assert.equal(resolveStatus({
            expected: "500.00", captured: "750.00", dueDate: due, graceDays: 5, asAt: at("2026-09-05")
        }), "Paid");
    });

    await t.test("nothing paid before the due date is Outstanding", () => {
        assert.equal(resolveStatus({
            expected: "500.00", captured: "0", dueDate: due, graceDays: 5, asAt: at("2026-09-05")
        }), "Outstanding");
    });

    await t.test("part paid before the due date is Partial", () => {
        assert.equal(resolveStatus({
            expected: "500.00", captured: "200.00", dueDate: due, graceDays: 5, asAt: at("2026-09-05")
        }), "Partial");
    });

    await t.test("REQ-55: grace runs to the END of its last day", () => {
        // Due 7 Sep + 5 days of grace. The 12th is still inside.
        assert.equal(resolveStatus({
            expected: "500.00", captured: "0", dueDate: due, graceDays: 5, asAt: at("2026-09-12T23:00:00")
        }), "Outstanding");
        // The 13th is not.
        assert.equal(resolveStatus({
            expected: "500.00", captured: "0", dueDate: due, graceDays: 5, asAt: at("2026-09-13T06:00:00")
        }), "Late");
    });

    await t.test("part paid and past grace is Late, not Partial", () => {
        // The case REQ-55 does not name. A part-payment that is still short is
        // still overdue; the amount paid survives on captured_amount.
        assert.equal(resolveStatus({
            expected: "500.00", captured: "499.99", dueDate: due, graceDays: 5, asAt: at("2026-09-20")
        }), "Late");
    });

    await t.test("no grace period means late the day after", () => {
        assert.equal(resolveStatus({
            expected: "500.00", captured: "0", dueDate: due, graceDays: 0, asAt: at("2026-09-08T01:00:00")
        }), "Late");
    });

    await t.test("a penalty is due exactly when the status is Late", () => {
        assert.equal(penaltyIsDue("Late"), true);
        for (const s of ["Paid", "Partial", "Outstanding"]) {
            assert.equal(penaltyIsDue(s), false);
        }
    });

    await t.test("lateFrom names the first late day", () => {
        assert.equal(lateFrom("2026-09-07", 5).toISOString().slice(0, 10), "2026-09-13");
    });
});

// ---------------------------------------------------------------------------
test("capture guards — REQ-52, REQ-60", async (t) => {

    await t.test("REQ-60: zero or less is refused", () => {
        assert.ok(checkCaptureAmount("0"));
        assert.ok(checkCaptureAmount("-50"));
        assert.ok(checkCaptureAmount("0.00"));
    });

    await t.test("a real amount is accepted", () => {
        assert.equal(checkCaptureAmount("500"), null);
        assert.equal(checkCaptureAmount("0.01"), null);
    });

    await t.test("nonsense is refused with a readable message", () => {
        assert.match(checkCaptureAmount("abc"), /amount received/i);
    });

    await t.test("a slipped decimal point is caught", () => {
        assert.ok(checkCaptureAmount("1000000000"));
    });

    await t.test("REQ-52: an electronic transfer must carry its reference", () => {
        assert.ok(checkMethod("Electronic funds transfer", "").reference);
        assert.equal(checkMethod("Electronic funds transfer", "FNB88213"), null);
    });

    await t.test("REQ-51: only the three named methods are accepted", () => {
        assert.equal(checkMethod("Cash"), null);
        assert.equal(checkMethod("Other"), null);
        assert.ok(checkMethod("Debit order", "x").method);
        assert.ok(checkMethod("Bitcoin", "x").method);
    });
});

// ---------------------------------------------------------------------------
test("constitution consistency — REQ-22 to REQ-29", async (t) => {
    const sound = {
        clubType: "Rotating", contributionAmount: "500", cycleFrequency: "Monthly",
        penaltyAmount: "50", gracePeriodDays: 5, quorumPercentage: 60,
        exitNoticeDays: 30, payoutOrderMethod: "Random draw"
    };
    const check = (overrides) => validateConsistency({ ...sound, ...overrides });

    await t.test("a sound constitution passes", () => {
        assert.equal(check({}).valid, true);
    });

    await t.test("REQ-29: the contribution must exceed zero", () => {
        assert.ok(check({ contributionAmount: "0" }).errors.contributionAmount);
        assert.ok(check({ contributionAmount: "-100" }).errors.contributionAmount);
    });

    await t.test("REQ-29: grace may not reach the cycle length", () => {
        assert.ok(check({ gracePeriodDays: 28 }).errors.gracePeriodDays);
        assert.ok(check({ gracePeriodDays: 7, cycleFrequency: "Weekly" }).errors.gracePeriodDays);
        // Just inside is fine.
        assert.equal(check({ gracePeriodDays: 6, cycleFrequency: "Weekly" }).valid, true);
    });

    await t.test("REQ-29: quorum must fall between 1 and 100", () => {
        assert.ok(check({ quorumPercentage: 0 }).errors.quorumPercentage);
        assert.ok(check({ quorumPercentage: 101 }).errors.quorumPercentage);
        assert.equal(check({ quorumPercentage: 1 }).valid, true);
        assert.equal(check({ quorumPercentage: 100 }).valid, true);
    });

    await t.test("REQ-28: a rotating club needs a payout order method", () => {
        assert.ok(check({ payoutOrderMethod: null }).errors.payoutOrderMethod);
        assert.ok(check({ payoutOrderMethod: "Alphabetical" }).errors.payoutOrderMethod);
    });

    await t.test("REQ-27: a burial society needs a benefit schedule", () => {
        const burial = { clubType: "Burial", payoutOrderMethod: null };
        assert.ok(check({ ...burial, benefitSchedule: [] }).errors.benefitSchedule);
        assert.ok(check({
            ...burial, benefitSchedule: [{ category: "Spouse", amount: "0" }]
        }).errors.benefitSchedule);
        assert.equal(check({
            ...burial, benefitSchedule: [{ category: "Spouse", amount: "8000" }], waitingPeriodDays: 180
        }).valid, true);
    });

    await t.test("a monthly cycle is measured as the shortest month", () => {
        // 28, so a constitution that passes is coherent in February too.
        assert.equal(cycleLengthDays("Monthly"), 28);
        assert.equal(cycleLengthDays("Weekly"), 7);
        assert.equal(cycleLengthDays("Fortnightly"), 14);
    });
});