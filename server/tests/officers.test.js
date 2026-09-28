"use strict";

/**
 * Officer capacity. Not an SRS requirement — see decisions.md for why this
 * was added and where the thresholds came from.
 *
 * No database. src/rules/officers.js decides whether a club this size may
 * gain another holder of a role; members.service.js applies it in both
 * registerMember() and assignRole(), checked separately against a real
 * PostgreSQL.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const { maxHoldersFor, assessRoleCapacity } = require("../src/rules/officers");

test("maxHoldersFor", async (t) => {
    await t.test("a Chairperson is always exactly one, at any size", () => {
        for (const n of [0, 1, 50, 99, 100, 500, 10000]) {
            assert.equal(maxHoldersFor("Chairperson", n), 1, `n=${n}`);
        }
    });

    await t.test("Treasurer: one per 100 members, at least one", () => {
        assert.equal(maxHoldersFor("Treasurer", 0), 1);
        assert.equal(maxHoldersFor("Treasurer", 1), 1);
        assert.equal(maxHoldersFor("Treasurer", 99), 1);
        assert.equal(maxHoldersFor("Treasurer", 100), 2);
        assert.equal(maxHoldersFor("Treasurer", 199), 2);
        assert.equal(maxHoldersFor("Treasurer", 200), 3);
        assert.equal(maxHoldersFor("Treasurer", 350), 4);
    });

    await t.test("Secretary: one per 150 members", () => {
        assert.equal(maxHoldersFor("Secretary", 149), 1);
        assert.equal(maxHoldersFor("Secretary", 150), 2);
        assert.equal(maxHoldersFor("Secretary", 300), 3);
    });

    await t.test("an ordinary Member has no cap", () => {
        assert.equal(maxHoldersFor("Member", 0), Infinity);
        assert.equal(maxHoldersFor("Member", 100000), Infinity);
    });

    await t.test("a negative or missing count is treated as zero, not refused", () => {
        assert.equal(maxHoldersFor("Treasurer", -5), 1);
        assert.equal(maxHoldersFor("Treasurer", undefined), 1);
        assert.equal(maxHoldersFor("Treasurer", "not a number"), 1);
    });
});

test("assessRoleCapacity", async (t) => {
    await t.test("eligible while under the cap", () => {
        const r = assessRoleCapacity({ role: "Treasurer", currentHolders: 1, activeMemberCount: 150 });
        assert.equal(r.eligible, true);
        assert.deepEqual(r.refusals, []);
    });

    await t.test("refused once at the cap, naming the current count and the limit", () => {
        const r = assessRoleCapacity({ role: "Treasurer", currentHolders: 2, activeMemberCount: 150 });
        assert.equal(r.eligible, false);
        assert.equal(r.refusals[0].code, "ROLE_AT_CAPACITY");
        assert.match(r.refusals[0].message, /2 members holding the Treasurer role/);
    });

    await t.test("growing past a threshold allows one more, without a further explicit change", () => {
        // One Treasurer already; a second is refused below 100 members and
        // allowed from 100 members, with nothing else about the rule changing.
        const before = assessRoleCapacity({ role: "Treasurer", currentHolders: 1, activeMemberCount: 99 });
        const after = assessRoleCapacity({ role: "Treasurer", currentHolders: 1, activeMemberCount: 100 });
        assert.equal(before.eligible, false, "a second treasurer at 99 members exceeds the cap of 1");
        assert.equal(after.eligible, true, "a second treasurer at 100 members is within the new cap of 2");
    });

    await t.test("Chairperson's message states the rule plainly rather than talking about growth", () => {
        const r = assessRoleCapacity({ role: "Chairperson", currentHolders: 1, activeMemberCount: 10 });
        assert.match(r.refusals[0].message, /exactly one Chairperson/);
    });

    await t.test("singular and plural in the message match the actual count", () => {
        const one = assessRoleCapacity({ role: "Secretary", currentHolders: 1, activeMemberCount: 1 });
        assert.match(one.refusals[0].message, /1 member holding/);
        const two = assessRoleCapacity({ role: "Secretary", currentHolders: 2, activeMemberCount: 150 });
        assert.match(two.refusals[0].message, /2 members holding/);
    });
});