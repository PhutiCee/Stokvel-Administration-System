"use strict";

/**
 * Payout queue rules. REQ-71 to REQ-78.
 *
 * No database and no network. These exercise src/rules/queue.js, which is
 * where the queue's ordering decisions actually live. The database and the
 * service layer are checked separately, against a real PostgreSQL, because a
 * unique-position constraint and a locked transaction are not things a pure
 * function test can prove.
 */

const test = require("node:test");
const assert = require("node:assert/strict");

const {
    orderOf, withPositions, head, moveToEnd, removeMember, appendMember, swap,
    drawOrder, seniorityOrder, checkProposedOrder, projectHeadDates
} = require("../src/rules/queue");
const { addMonths, addCycles } = require("../src/lib/dates");

// ---------------------------------------------------------------------------
test("date arithmetic used by the queue projection", async (t) => {
    await t.test("addMonths keeps the day where it exists", () => {
        assert.equal(addMonths("2026-03-15", 1), "2026-04-15");
        assert.equal(addMonths("2026-01-15", 11), "2026-12-15");
    });

    await t.test("addMonths falls back to the last day of a shorter month", () => {
        assert.equal(addMonths("2026-01-31", 1), "2026-02-28");
        assert.equal(addMonths("2028-01-31", 1), "2028-02-29"); // leap year
        assert.equal(addMonths("2026-08-31", 1), "2026-09-30");
    });

    await t.test("addMonths crosses a year boundary", () => {
        assert.equal(addMonths("2026-12-01", 2), "2027-02-01");
    });

    await t.test("addCycles moves by the constitution's frequency", () => {
        assert.equal(addCycles("2026-09-08", 1, "Weekly"), "2026-09-15");
        assert.equal(addCycles("2026-09-08", 1, "Fortnightly"), "2026-09-22");
        assert.equal(addCycles("2026-09-08", 1, "Monthly"), "2026-10-08");
        assert.equal(addCycles("2026-01-31", 1, "Monthly"), "2026-02-28");
    });

    await t.test("an unknown frequency is refused rather than guessed at", () => {
        assert.throws(() => addCycles("2026-09-08", 1, "Yearly"), TypeError);
    });
});

// ---------------------------------------------------------------------------
test("orderOf, withPositions, head — reading and writing the queue shape", async (t) => {
    await t.test("orderOf reads rows in position order, regardless of row order", () => {
        const rows = [{ memberId: "c", position: 3 }, { memberId: "a", position: 1 }, { memberId: "b", position: 2 }];
        assert.deepEqual(orderOf(rows), ["a", "b", "c"]);
    });

    await t.test("orderOf ignores rows with no position", () => {
        const rows = [{ memberId: "a", position: 1 }, { memberId: "x", position: null }, { memberId: "b", position: 2 }];
        assert.deepEqual(orderOf(rows), ["a", "b"]);
    });

    await t.test("withPositions numbers 1..n with no gaps", () => {
        assert.deepEqual(withPositions(["a", "b", "c"]), [
            { memberId: "a", position: 1 }, { memberId: "b", position: 2 }, { memberId: "c", position: 3 }
        ]);
    });

    await t.test("head is the first member, or null when the queue is empty", () => {
        assert.equal(head(["a", "b"]), "a");
        assert.equal(head([]), null);
    });
});

// ---------------------------------------------------------------------------
test("moveToEnd — REQ-73 (a payout advances the queue), REQ-77 (deferral)", async (t) => {
    await t.test("the named member goes to the end, everyone else keeps their order", () => {
        assert.deepEqual(moveToEnd(["a", "b", "c", "d"], "a"), ["b", "c", "d", "a"]);
        assert.deepEqual(moveToEnd(["a", "b", "c", "d"], "c"), ["a", "b", "d", "c"]);
    });

    await t.test("moving the member already at the end changes nothing", () => {
        assert.deepEqual(moveToEnd(["a", "b", "c"], "c"), ["a", "b", "c"]);
    });

    await t.test("a member not in the queue is refused, not silently appended", () => {
        assert.throws(() => moveToEnd(["a", "b"], "z"), /not in the queue/);
    });

    await t.test("the input array is not mutated", () => {
        const input = ["a", "b", "c"];
        moveToEnd(input, "a");
        assert.deepEqual(input, ["a", "b", "c"]);
    });
});

// ---------------------------------------------------------------------------
test("removeMember, appendMember — REQ-76 (exit, expulsion, admission)", async (t) => {
    await t.test("removing a member closes the gap and keeps everyone else's order", () => {
        assert.deepEqual(removeMember(["a", "b", "c", "d"], "b"), ["a", "c", "d"]);
        assert.deepEqual(removeMember(["a", "b", "c"], "a"), ["b", "c"]);
        assert.deepEqual(removeMember(["a", "b", "c"], "c"), ["a", "b"]);
    });

    await t.test("removing someone not in the queue is refused", () => {
        assert.throws(() => removeMember(["a", "b"], "z"), /not in the queue/);
    });

    await t.test("a new member is appended to the end", () => {
        assert.deepEqual(appendMember(["a", "b"], "c"), ["a", "b", "c"]);
        assert.deepEqual(appendMember([], "a"), ["a"]);
    });

    await t.test("a member already in the queue cannot be appended again", () => {
        assert.throws(() => appendMember(["a", "b"], "a"), /already in the queue/);
    });
});

// ---------------------------------------------------------------------------
test("swap — REQ-75 (exchange of positions), REQ-76 (everyone else unaffected)", async (t) => {
    await t.test("two members exchange places, nobody else moves", () => {
        assert.deepEqual(swap(["a", "b", "c", "d"], "a", "d"), ["d", "b", "c", "a"]);
        assert.deepEqual(swap(["a", "b", "c", "d"], "b", "c"), ["a", "c", "b", "d"]);
    });

    await t.test("adjacent members swap correctly", () => {
        assert.deepEqual(swap(["a", "b"], "a", "b"), ["b", "a"]);
    });

    await t.test("a member cannot exchange with themselves", () => {
        assert.throws(() => swap(["a", "b"], "a", "a"), /themselves/);
    });

    await t.test("both members must be in the queue", () => {
        assert.throws(() => swap(["a", "b"], "a", "z"), /not in the queue/);
        assert.throws(() => swap(["a", "b"], "z", "a"), /not in the queue/);
    });
});

// ---------------------------------------------------------------------------
test("drawOrder — REQ-71 Random draw", async (t) => {
    await t.test("every member appears exactly once", () => {
        const seq = [3, 2, 1, 0];
        let i = 0;
        const drawn = drawOrder(["a", "b", "c", "d", "e"], () => seq[i++ % seq.length]);
        assert.deepEqual([...drawn].sort(), ["a", "b", "c", "d", "e"]);
        assert.equal(drawn.length, 5);
    });

    await t.test("a fixed random source gives a deterministic, reproducible order", () => {
        // Fisher-Yates walking down from the end, always swapping with index 0:
        // [a,b,c,d] -> [d,b,c,a] -> [c,b,d,a] -> [b,c,d,a].
        const fixed = () => 0;
        assert.deepEqual(drawOrder(["a", "b", "c", "d"], fixed), ["b", "c", "d", "a"]);
    });

    await t.test("the input array is not mutated", () => {
        const input = ["a", "b", "c"];
        drawOrder(input, () => 0);
        assert.deepEqual(input, ["a", "b", "c"]);
    });

    await t.test("a single member draws trivially", () => {
        assert.deepEqual(drawOrder(["a"], () => 0), ["a"]);
    });
});

// ---------------------------------------------------------------------------
test("seniorityOrder — REQ-71 Seniority", async (t) => {
    await t.test("earliest join date first", () => {
        const members = [
            { memberId: "c", joinDate: "2026-03-01", registeredAt: "2026-03-01T00:00:00Z" },
            { memberId: "a", joinDate: "2025-01-01", registeredAt: "2025-01-01T00:00:00Z" },
            { memberId: "b", joinDate: "2025-06-01", registeredAt: "2025-06-01T00:00:00Z" }
        ];
        assert.deepEqual(seniorityOrder(members), ["a", "b", "c"]);
    });

    await t.test("a tied join date is broken by registration time, then by id, so the result is stable", () => {
        const members = [
            { memberId: "z", joinDate: "2026-01-01", registeredAt: "2026-01-02T00:00:00Z" },
            { memberId: "a", joinDate: "2026-01-01", registeredAt: "2026-01-01T00:00:00Z" },
            { memberId: "m", joinDate: "2026-01-01", registeredAt: "2026-01-01T00:00:00Z" }
        ];
        assert.deepEqual(seniorityOrder(members), ["a", "m", "z"]);
    });

    await t.test("a malformed join date is refused, not silently sorted first or last", () => {
        assert.throws(() => seniorityOrder([{ memberId: "a", joinDate: "not-a-date", registeredAt: "x" }]), TypeError);
    });

    await t.test("the input array is not mutated", () => {
        const members = [{ memberId: "b", joinDate: "2026-02-01", registeredAt: "x" }, { memberId: "a", joinDate: "2026-01-01", registeredAt: "x" }];
        const copy = members.map((m) => ({ ...m }));
        seniorityOrder(members);
        assert.deepEqual(members, copy);
    });
});

// ---------------------------------------------------------------------------
test("checkProposedOrder — REQ-71 Negotiated", async (t) => {
    const current = ["a", "b", "c"];

    await t.test("a full permutation of the current members is accepted", () => {
        assert.equal(checkProposedOrder(current, ["c", "a", "b"]).valid, true);
    });

    await t.test("a member missing from the proposed order is refused", () => {
        const r = checkProposedOrder(current, ["a", "b"]);
        assert.equal(r.valid, false);
        assert.match(r.error, /leaves out/);
    });

    await t.test("a name not in the current queue is refused", () => {
        const r = checkProposedOrder(current, ["a", "b", "z"]);
        assert.equal(r.valid, false);
        assert.match(r.error, /not in this club's queue/);
    });

    await t.test("a duplicate in the proposed order is refused", () => {
        const r = checkProposedOrder(current, ["a", "a", "b"]);
        assert.equal(r.valid, false);
        assert.match(r.error, /more than once/);
    });

    await t.test("something that is not a list is refused", () => {
        assert.equal(checkProposedOrder(current, null).valid, false);
        assert.equal(checkProposedOrder(current, "a,b,c").valid, false);
    });
});

// ---------------------------------------------------------------------------
test("projectHeadDates — REQ-78", async (t) => {
    await t.test("the head is due on the given date, each place after adds one cycle", () => {
        const dates = projectHeadDates(["a", "b", "c"], "2026-10-08", "Monthly");
        assert.equal(dates.get("a"), "2026-10-08");
        assert.equal(dates.get("b"), "2026-11-08");
        assert.equal(dates.get("c"), "2026-12-08");
    });

    await t.test("with no next payout date, nothing is projected", () => {
        const dates = projectHeadDates(["a", "b"], null, "Monthly");
        assert.equal(dates.get("a"), null);
        assert.equal(dates.get("b"), null);
    });

    await t.test("weekly and fortnightly frequencies project correctly", () => {
        const weekly = projectHeadDates(["a", "b"], "2026-09-08", "Weekly");
        assert.equal(weekly.get("b"), "2026-09-15");
        const fortnightly = projectHeadDates(["a", "b"], "2026-09-08", "Fortnightly");
        assert.equal(fortnightly.get("b"), "2026-09-22");
    });

    await t.test("an empty queue projects nothing", () => {
        assert.equal(projectHeadDates([], "2026-10-08", "Monthly").size, 0);
    });
});