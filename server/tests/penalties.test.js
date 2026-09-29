"use strict";

/**
 * Penalty waiver rule. REQ-63, BR-13.
 *
 * No database. src/rules/penalties.js decides whether a waiver request may
 * proceed at all; the reversing ledger entry, the immutability trigger on
 * `penalty` (migration 014) and the Chairperson-only route are checked
 * separately, against a real PostgreSQL.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { assessWaiver } = require("../src/rules/penalties");

test("assessWaiver — REQ-63, BR-13", async (t) => {
    await t.test("eligible with a reason and not already waived", () => {
        const r = assessWaiver({ alreadyWaived: false, reason: "Hospitalised the week it was due" });
        assert.equal(r.eligible, true);
        assert.deepEqual(r.refusals, []);
    });

    await t.test("BR-13: a penalty already waived cannot be waived again", () => {
        const r = assessWaiver({ alreadyWaived: true, reason: "x" });
        assert.ok(r.refusals.some((x) => x.code === "ALREADY_WAIVED"));
    });

    await t.test("REQ-63: a reason is required", () => {
        for (const reason of [undefined, null, "", "   "]) {
            const r = assessWaiver({ alreadyWaived: false, reason });
            assert.ok(r.refusals.some((x) => x.code === "REASON_REQUIRED"), JSON.stringify(reason));
        }
    });

    await t.test("both reasons are reported at once", () => {
        const r = assessWaiver({ alreadyWaived: true, reason: "" });
        assert.deepEqual(new Set(r.refusals.map((x) => x.code)), new Set(["ALREADY_WAIVED", "REASON_REQUIRED"]));
    });
});