"use strict";

/**
 * Constitution versioning tests. REQ-30, REQ-31, REQ-33.
 *
 * No database and no network, like rules.test.js. These cover the pure rules in
 * src/rules/versioning.js and the date helpers in src/lib/dates.js. The
 * database triggers in migration 010 are checked against a real PostgreSQL
 * separately, because a test that needs no database cannot prove a trigger.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    versionInForce, diffVersions, validateNewVersion, normaliseForClubType
} = require("../src/rules/versioning");
const { isIsoDate, assertIsoDate, addDays, compareIso, todayIso } = require("../src/lib/dates");

const v = (version, effectiveDate, extra = {}) => ({ version, effectiveDate, ...extra });

// ---------------------------------------------------------------------------
test("dates - calendar days as text, never as Date objects", async (t) => {

    await t.test("only real calendar dates are accepted", () => {
        assert.equal(isIsoDate("2026-09-20"), true);
        assert.equal(isIsoDate("2026-02-30"), false);
        assert.equal(isIsoDate("2026-9-2"), false);
        assert.equal(isIsoDate("20/09/2026"), false);
        assert.equal(isIsoDate(new Date()), false);
        assert.equal(isIsoDate(null), false);
        assert.throws(() => assertIsoDate("tomorrow"), TypeError);
    });

    await t.test("addDays crosses month, year and leap-day boundaries", () => {
        assert.equal(addDays("2026-02-27", 2), "2026-03-01");
        assert.equal(addDays("2028-02-28", 1), "2028-02-29");
        assert.equal(addDays("2026-12-31", 1), "2027-01-01");
        assert.equal(addDays("2026-03-01", -1), "2026-02-28");
    });

    await t.test("compareIso orders dates", () => {
        assert.equal(compareIso("2026-01-01", "2026-01-02"), -1);
        assert.equal(compareIso("2026-01-02", "2026-01-02"), 0);
        assert.equal(compareIso("2027-01-01", "2026-12-31"), 1);
    });

    await t.test("todayIso is the South African calendar date, not the UTC one", () => {
        // 23:30 UTC on the 20th is 01:30 on the 21st in South Africa.
        assert.equal(todayIso(new Date("2026-09-20T23:30:00Z")), "2026-09-21");
        assert.equal(todayIso(new Date("2026-09-20T12:00:00Z")), "2026-09-20");
    });
});

// ---------------------------------------------------------------------------
test("versionInForce - REQ-31: the version in force on the date", async (t) => {
    const versions = [v(1, "2025-01-01"), v(2, "2025-07-01"), v(3, "2026-03-01")];

    await t.test("a date between two versions resolves to the earlier one", () => {
        assert.equal(versionInForce(versions, "2025-06-30").version, 1);
        assert.equal(versionInForce(versions, "2026-02-28").version, 2);
    });

    await t.test("a version is in force ON its effective date", () => {
        assert.equal(versionInForce(versions, "2025-07-01").version, 2);
        assert.equal(versionInForce(versions, "2025-01-01").version, 1);
    });

    await t.test("the day before a version takes effect it is not yet in force", () => {
        assert.equal(versionInForce(versions, "2026-02-28").version, 2);
        assert.equal(versionInForce(versions, "2026-03-01").version, 3);
    });

    await t.test("a date after the last version resolves to the last", () => {
        assert.equal(versionInForce(versions, "2031-12-31").version, 3);
    });

    await t.test("a date before the first version resolves to nothing", () => {
        assert.equal(versionInForce(versions, "2024-12-31"), null);
        assert.equal(versionInForce([], "2026-01-01"), null);
    });

    await t.test("the answer does not depend on the order the versions arrive in", () => {
        const shuffled = [versions[2], versions[0], versions[1]];
        for (const d of ["2025-03-01", "2025-08-01", "2027-01-01"]) {
            assert.equal(versionInForce(shuffled, d).version, versionInForce(versions, d).version);
        }
    });

    await t.test("two versions with one effective date: the later one wins", () => {
        const tied = [v(1, "2025-01-01"), v(2, "2025-06-01"), v(3, "2025-06-01")];
        assert.equal(versionInForce(tied, "2025-06-01").version, 3);
    });

    await t.test("a date that is not a calendar date is refused, not guessed at", () => {
        assert.throws(() => versionInForce(versions, "2026-13-01"), TypeError);
        assert.throws(() => versionInForce(versions, new Date()), TypeError);
    });
});

// ---------------------------------------------------------------------------
test("diffVersions - what an amendment changes", async (t) => {
    const base = {
        contributionAmount: "500.00", cycleFrequency: "Monthly", penaltyAmount: "50.00",
        gracePeriodDays: 5, quorumPercentage: 60, exitNoticeDays: 30,
        payoutOrderMethod: "Random draw", forfeitureRule: null,
        waitingPeriodDays: 0, benefitSchedule: []
    };

    await t.test("identical parameters differ in nothing", () => {
        assert.deepEqual(diffVersions(base, { ...base }), []);
    });

    await t.test("money is compared in cents, so 500 and 500.00 are the same", () => {
        assert.deepEqual(diffVersions(base, { ...base, contributionAmount: "500" }), []);
        assert.deepEqual(
            diffVersions(base, { ...base, contributionAmount: "500.01" }).map((c) => c.field),
            ["contributionAmount"]
        );
    });

    await t.test("null, undefined and an empty string are the same absence", () => {
        assert.deepEqual(diffVersions(base, { ...base, forfeitureRule: "" }), []);
        assert.deepEqual(diffVersions(base, { ...base, forfeitureRule: undefined }), []);
    });

    await t.test("the benefit schedule is compared without regard to row order", () => {
        const a = { ...base, benefitSchedule: [{ category: "Spouse", amount: "20000" }, { category: "Child", amount: "10000" }] };
        const b = { ...base, benefitSchedule: [{ category: "Child", amount: "10000.00" }, { category: "spouse", amount: "20000" }] };
        assert.deepEqual(diffVersions(a, b), []);
        const c = { ...a, benefitSchedule: [{ category: "Spouse", amount: "25000" }, { category: "Child", amount: "10000" }] };
        assert.deepEqual(diffVersions(a, c).map((x) => x.field), ["benefitSchedule"]);
    });

    await t.test("fields outside the amendable set are never reported", () => {
        assert.deepEqual(diffVersions({ ...base, version: 1 }, { ...base, version: 2 }), []);
    });
});

// ---------------------------------------------------------------------------
test("validateNewVersion - REQ-29, REQ-30, REQ-33", async (t) => {
    const today = "2026-09-20";
    const rotating = v(1, "2026-01-01", {
        contributionAmount: "500.00", cycleFrequency: "Monthly", cycleStartDate: "2026-01-01",
        penaltyAmount: "50.00", gracePeriodDays: 5, quorumPercentage: 60, exitNoticeDays: 30,
        payoutOrderMethod: "Random draw", forfeitureRule: null,
        waitingPeriodDays: 0, benefitSchedule: []
    });
    const amend = (over = {}) => validateNewVersion({
        existing: [rotating], clubType: "Rotating",
        changes: { contributionAmount: "550" }, effectiveDate: "2026-10-01",
        amendmentNote: "Agreed at the annual meeting", today, ...over
    });

    await t.test("a sound amendment is accepted as the next version", () => {
        const r = amend();
        assert.equal(r.valid, true, JSON.stringify(r.errors));
        assert.equal(r.nextVersion, 2);
        assert.deepEqual(r.changed.map((c) => c.field), ["contributionAmount"]);
    });

    await t.test("the amendment is laid over the version in force, so unmentioned fields survive", () => {
        const r = amend();
        assert.equal(r.merged.penaltyAmount, "50.00");
        assert.equal(r.merged.quorumPercentage, 60);
        assert.equal(r.merged.contributionAmount, "550");
    });

    await t.test("REQ-33: an amendment cannot take effect in the past", () => {
        assert.ok(amend({ effectiveDate: "2026-09-19" }).errors.effectiveDate);
    });

    await t.test("REQ-33: taking effect today is allowed, it is not retroactive", () => {
        assert.equal(amend({ effectiveDate: today }).valid, true);
    });

    await t.test("an amendment must take effect after the latest version, not on or before it", () => {
        const scheduled = [rotating, { ...rotating, version: 2, effectiveDate: "2026-11-01" }];
        const r = amend({ existing: scheduled, effectiveDate: "2026-11-01" });
        assert.ok(r.errors.effectiveDate);
        assert.equal(r.nextVersion, 3);
        assert.ok(amend({ existing: scheduled, effectiveDate: "2026-10-15" }).errors.effectiveDate);
        assert.equal(amend({ existing: scheduled, effectiveDate: "2026-11-02" }).valid, true);
    });

    await t.test("an amendment that changes nothing is refused", () => {
        assert.ok(amend({ changes: { contributionAmount: "500" } }).errors.changes);
        assert.ok(amend({ changes: {} }).errors.changes);
        assert.ok(amend({ changes: null }).errors.changes);
    });

    await t.test("a reason is required", () => {
        assert.ok(amend({ amendmentNote: "" }).errors.amendmentNote);
        assert.ok(amend({ amendmentNote: "   " }).errors.amendmentNote);
        assert.ok(amend({ amendmentNote: undefined }).errors.amendmentNote);
    });

    await t.test("a malformed effective date is refused", () => {
        assert.ok(amend({ effectiveDate: "next month" }).errors.effectiveDate);
        assert.ok(amend({ effectiveDate: undefined }).errors.effectiveDate);
    });

    await t.test("REQ-29: the amended constitution must be internally consistent", () => {
        assert.ok(amend({ changes: { gracePeriodDays: 28 } }).errors.gracePeriodDays);
        assert.ok(amend({ changes: { quorumPercentage: 0 } }).errors.quorumPercentage);
        assert.ok(amend({ changes: { contributionAmount: "0" } }).errors.contributionAmount);
    });

    await t.test("fields that are not amendable are ignored rather than trusted", () => {
        const r = amend({ changes: { contributionAmount: "550", clubType: "Burial", cycleStartDate: "2020-01-01", version: 9 } });
        assert.equal(r.valid, true);
        assert.deepEqual(r.changed.map((c) => c.field), ["contributionAmount"]);
        assert.equal(r.merged.cycleStartDate, "2026-01-01");
        assert.equal(r.nextVersion, 2);
    });

    await t.test("a club with no constitution has nothing to amend", () => {
        const r = validateNewVersion({
            existing: [], clubType: "Rotating", changes: { contributionAmount: "550" },
            effectiveDate: "2026-10-01", amendmentNote: "x", today
        });
        assert.equal(r.valid, false);
        assert.ok(r.errors.constitution);
    });

    await t.test("a Rotating club cannot acquire a benefit schedule or a waiting period", () => {
        const r = amend({ changes: { contributionAmount: "550", waitingPeriodDays: 90, benefitSchedule: [{ category: "Spouse", amount: "1" }] } });
        assert.equal(r.merged.waitingPeriodDays, 0);
        assert.deepEqual(r.merged.benefitSchedule, []);
    });

    await t.test("a burial society keeps its schedule and cannot acquire a payout order", () => {
        const burial = v(1, "2026-01-01", {
            contributionAmount: "150.00", cycleFrequency: "Monthly", cycleStartDate: "2026-01-01",
            penaltyAmount: "0.00", gracePeriodDays: 5, quorumPercentage: 50, exitNoticeDays: 30,
            payoutOrderMethod: "Random draw",   // stray value written before club-type rules were applied
            forfeitureRule: null, waitingPeriodDays: 180,
            benefitSchedule: [{ category: "Spouse", amount: "20000" }]
        });
        const base = { existing: [burial], clubType: "Burial", effectiveDate: "2026-10-01", amendmentNote: "x", today };

        // Dropping the stray payout order is not an amendment the members voted on.
        assert.ok(validateNewVersion({ ...base, changes: { contributionAmount: "150" } }).errors.changes);

        const r = validateNewVersion({ ...base, changes: { waitingPeriodDays: 90 } });
        assert.equal(r.valid, true, JSON.stringify(r.errors));
        assert.deepEqual(r.changed.map((c) => c.field), ["waitingPeriodDays"]);
        assert.equal(r.merged.payoutOrderMethod, null);
        assert.equal(r.merged.benefitSchedule.length, 1);
    });

    await t.test("normaliseForClubType leaves an Accumulating club with neither", () => {
        const n = normaliseForClubType("Accumulating", {
            payoutOrderMethod: "Seniority", waitingPeriodDays: 30, benefitSchedule: [{ category: "x", amount: "1" }]
        });
        assert.equal(n.payoutOrderMethod, null);
        assert.equal(n.waitingPeriodDays, 0);
        assert.deepEqual(n.benefitSchedule, []);
    });
});