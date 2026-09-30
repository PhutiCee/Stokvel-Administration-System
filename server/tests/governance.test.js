"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../src/rules/governance");
const { can } = require("../src/rules/permissions");
const base = {
    date: "2026-09-29",
    agenda: "Annual meeting",
    minutes: "Decisions recorded",
    attendance: ["a", "b"],
};
test("quorum rounds up and the boundary is binding", () => {
    assert.equal(
        rules.meeting(
            base,
            ["a", "b", "c"],
            { quorumPercentage: 67 },
            base.date,
        ).quorate,
        false,
    );
    assert.equal(
        rules.meeting(
            base,
            ["a", "b", "c"],
            { quorumPercentage: 66 },
            base.date,
        ).quorate,
        true,
    );
});
test("duplicate and foreign attendance are rejected", () => {
    for (const attendance of [["a", "a"], ["foreign"]])
        assert.throws(() =>
            rules.meeting(
                { ...base, attendance },
                ["a", "b"],
                { quorumPercentage: 50 },
                base.date,
            ),
        );
});
test("meeting cannot be in the future or an invalid calendar date", () => {
    for (const date of ["2026-02-30", "2026-09-30"])
        assert.throws(() =>
            rules.meeting(
                { ...base, date },
                ["a", "b"],
                { quorumPercentage: 50 },
                base.date,
            ),
        );
});
test("all non-quorate resolutions are advisory even with unanimous votes", () => {
    for (const kind of ["General", "Amendment", "Expulsion"])
        assert.equal(
            rules.resolution(
                {
                    kind,
                    text: "Motion",
                    votesFor: 2,
                    votesAgainst: 0,
                    abstentions: 0,
                },
                { attendance_count: 2, quorate: false },
            ).outcome,
            "Advisory",
        );
});
test("ties and abstentions cannot create a majority", () => {
    assert.equal(
        rules.resolution(
            {
                kind: "General",
                text: "Motion",
                votesFor: 2,
                votesAgainst: 2,
                abstentions: 0,
            },
            { attendance_count: 4, quorate: true },
        ).outcome,
        "Rejected",
    );
    assert.equal(
        rules.resolution(
            {
                kind: "Expulsion",
                text: "Motion",
                votesFor: 1,
                votesAgainst: 0,
                abstentions: 3,
            },
            { attendance_count: 4, quorate: true },
        ).outcome,
        "Rejected",
    );
});
test("amendment uses the configured percentage of those present", () => {
    const input = {
            kind: "Amendment",
            text: "Change",
            votesFor: 2,
            votesAgainst: 1,
            abstentions: 0,
        },
        meeting = { attendance_count: 3, quorate: true };
    assert.equal(rules.resolution(input, meeting, 66).outcome, "Carried");
    assert.equal(rules.resolution(input, meeting, 67).outcome, "Rejected");
    assert.equal(rules.resolution(input, meeting).outcome, "Rejected");
});
test("votes must be non-negative whole numbers and exactly match attendance", () => {
    for (const votesFor of [-1, 1.5, "2", NaN, 3])
        assert.throws(() =>
            rules.resolution(
                {
                    kind: "General",
                    text: "x",
                    votesFor,
                    votesAgainst: 0,
                    abstentions: 0,
                },
                { attendance_count: 2, quorate: true },
            ),
        );
});
test("no effect for advisory, rejected, or already applied resolutions", () => {
    for (const row of [
        { outcome: "Advisory" },
        { outcome: "Rejected" },
        { outcome: "Carried", applied_at: "today" },
    ])
        assert.throws(() => rules.assertEffectable(row));
    assert.doesNotThrow(() => rules.assertEffectable({ outcome: "Carried" }));
});
test("governance permission boundaries", () => {
    assert.equal(can("Member", "view.governance"), true);
    assert.equal(can("Member", "governance.record"), false);
    assert.equal(can("Secretary", "governance.record"), true);
    assert.equal(can("Secretary", "constitution.propose"), false);
    assert.equal(can("Secretary", "governance.apply"), false);
    assert.equal(can("Chairperson", "governance.apply"), true);
    assert.equal(can("Treasurer", "governance.apply"), false);
    assert.equal(can("PlatformAdmin", "view.governance"), false);
});
