"use strict";
const { test } = require("node:test");
const assert = require("node:assert/strict");
const rules = require("../src/rules/governance");
const p = require("../src/rules/governance-policy");
const { can } = require("../src/rules/permissions");
const fraction = {
    numerator: 1,
    denominator: 2,
    comparison: "moreThan",
    basis: "present",
};
const basePolicy = {
    source: "Test charter clause 8",
    general: fraction,
    expulsion: fraction,
    suspendedCanVote: false,
    arrearsCanVote: true,
    amendmentClasses: [
        {
            name: "All amendments",
            fields: p.POLICY_FIELDS,
            rule: {
                ...fraction,
                numerator: 2,
                denominator: 3,
                comparison: "atLeast",
            },
        },
    ],
};
const meeting = {
    attendance_count: 5,
    voter_count: 4,
    eligible_voter_count: 8,
    voting_policy: basePolicy,
    quorate: true,
};
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
test("duplicate, foreign attendance, future and invalid dates are refused", () => {
    for (const attendance of [["a", "a"], ["foreign"]])
        assert.throws(() =>
            rules.meeting(
                { ...base, attendance },
                ["a", "b"],
                { quorumPercentage: 50 },
                base.date,
            ),
        );
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
test("there is no default voting policy; actual adopted source and rights required", () => {
    for (const value of [
        undefined,
        {},
        { ...basePolicy, source: "" },
        { ...basePolicy, suspendedCanVote: undefined },
    ])
        assert.throws(() => p.validatePolicy(value));
    assert.equal(p.validatePolicy(basePolicy).source, basePolicy.source);
});
test("classes must cover every parameter exactly once; cannot evade stricter class", () => {
    assert.throws(() =>
        p.validatePolicy({
            ...basePolicy,
            amendmentClasses: [
                {
                    name: "Partial",
                    fields: ["contributionAmount"],
                    rule: fraction,
                },
            ],
        }),
    );
    assert.throws(() =>
        p.validatePolicy({
            ...basePolicy,
            amendmentClasses: [
                ...basePolicy.amendmentClasses,
                {
                    name: "Duplicate",
                    fields: ["contributionAmount"],
                    rule: fraction,
                },
            ],
        }),
    );
    const policy = {
        ...basePolicy,
        amendmentClasses: [
            {
                name: "Financial",
                fields: ["contributionAmount"],
                rule: {
                    numerator: 2,
                    denominator: 3,
                    comparison: "atLeast",
                    basis: "present",
                },
            },
            {
                name: "Other",
                fields: p.POLICY_FIELDS.filter(
                    (f) => f !== "contributionAmount",
                ),
                rule: fraction,
            },
        ],
    };
    assert.equal(p.validatePolicy(policy).amendmentClasses.length, 2);
    const applicable = p.applicableRules(policy, "Amendment", {
        contributionAmount: "150",
        gracePeriodDays: 4,
    });
    assert.equal(applicable.length, 2);
    assert.equal(
        p.assessVote(
            { votesFor: 2, votesAgainst: 2, abstentions: 0 },
            meeting,
            applicable,
        ).outcome,
        "Rejected",
    );
    assert.equal(
        p.assessVote(
            { votesFor: 3, votesAgainst: 1, abstentions: 0 },
            meeting,
            applicable,
        ).outcome,
        "Carried",
    );
});
test("fractions use exact boundaries without approximating two thirds", () => {
    const rule = {
        numerator: 2,
        denominator: 3,
        comparison: "atLeast",
        basis: "present",
    };
    assert.equal(p.requiredVotes(rule, { present: 3 }), 2);
    assert.equal(
        p.requiredVotes({ ...rule, comparison: "moreThan" }, { present: 3 }),
        3,
    );
});
test("abstention denominator is taken from the constitution", () => {
    const vote = { votesFor: 2, votesAgainst: 1, abstentions: 1 };
    assert.equal(
        p.assessVote(vote, meeting, [{ rule: fraction }]).outcome,
        "Rejected",
    );
    assert.equal(
        p.assessVote(vote, meeting, [{ rule: { ...fraction, basis: "cast" } }])
            .outcome,
        "Carried",
    );
    assert.equal(
        p.requiredVotes({ ...fraction, basis: "eligible" }, { eligible: 8 }),
        5,
    );
});
test("unanimous non-quorate motion is advisory; zero votes never carry", () => {
    assert.equal(
        p.assessVote(
            { votesFor: 4, votesAgainst: 0, abstentions: 0 },
            { ...meeting, quorate: false },
            [{ rule: fraction }],
        ).outcome,
        "Advisory",
    );
    assert.equal(
        p.assessVote(
            { votesFor: 0, votesAgainst: 0, abstentions: 4 },
            meeting,
            [{ rule: { ...fraction, comparison: "atLeast", basis: "cast" } }],
        ).outcome,
        "Rejected",
    );
});
test("votes must be whole counts matching eligible voters, not all attendees", () => {
    for (const votesFor of [-1, 1.5, "4", NaN, 5])
        assert.throws(() =>
            p.assessVote(
                { votesFor, votesAgainst: 0, abstentions: 0 },
                meeting,
                [{ rule: fraction }],
            ),
        );
    assert.throws(() =>
        p.assessVote(
            { votesFor: 4, votesAgainst: 0, abstentions: 0 },
            { ...meeting, voting_policy: null },
            [{ rule: fraction }],
        ),
    );
});
test("voting eligibility respects explicit constitutional choices", () => {
    assert.equal(p.mayVote({ standing: "Suspended" }, basePolicy), false);
    assert.equal(
        p.mayVote(
            { standing: "Suspended" },
            { ...basePolicy, suspendedCanVote: true },
        ),
        true,
    );
    assert.equal(p.mayVote({ standing: "In arrears" }, basePolicy), true);
    assert.equal(p.mayVote({ standing: "Expelled" }, basePolicy), false);
});
test("advisory, rejected and applied resolutions cannot be applied", () => {
    for (const row of [
        { outcome: "Advisory" },
        { outcome: "Rejected" },
        { outcome: "Carried", applied_at: "today" },
    ])
        assert.throws(() => rules.assertEffectable(row));
});
test("only chair proposes and applies; secretary can record votes", () => {
    assert.equal(can("Secretary", "governance.record"), true);
    assert.equal(can("Secretary", "constitution.propose"), false);
    assert.equal(can("Member", "governance.record"), false);
    assert.equal(can("Chairperson", "governance.apply"), true);
    assert.equal(can("Secretary", "governance.apply"), false);
    assert.equal(can("PlatformAdmin", "view.governance"), false);
});
