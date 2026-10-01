"use strict";
const { BadRequest, RuleRefusal } = require("../lib/errors");
// This list defines supported parameters, NOT a club's amendment classes.
const POLICY_FIELDS = [
    "contributionAmount",
    "cycleFrequency",
    "penaltyAmount",
    "gracePeriodDays",
    "quorumPercentage",
    "exitNoticeDays",
    "payoutOrderMethod",
    "forfeitureRule",
    "waitingPeriodDays",
    "benefitSchedule",
    "yearEndMonth",
    "yearEndDay",
    "governancePolicy",
];
function fieldsFor(clubType) {
    if (!clubType) return POLICY_FIELDS;
    return POLICY_FIELDS.filter(
        (f) =>
            !(["payoutOrderMethod"].includes(f) && clubType !== "Rotating") &&
            !(
                ["waitingPeriodDays", "benefitSchedule"].includes(f) &&
                clubType !== "Burial"
            ) &&
            !(
                ["yearEndMonth", "yearEndDay"].includes(f) &&
                clubType !== "Accumulating"
            ),
    );
}
function checkRule(rule) {
    if (
        !rule ||
        !Number.isInteger(rule.numerator) ||
        !Number.isInteger(rule.denominator) ||
        rule.denominator < 1 ||
        rule.denominator > 10000 ||
        rule.numerator < 1 ||
        rule.numerator > rule.denominator ||
        !["atLeast", "moreThan"].includes(rule.comparison) ||
        (rule.comparison === "moreThan" &&
            rule.numerator === rule.denominator) ||
        !["present", "cast", "eligible"].includes(rule.basis)
    )
        throw new BadRequest(
            "Each voting rule needs a valid fraction, comparison and voting denominator.",
        );
    return {
        numerator: rule.numerator,
        denominator: rule.denominator,
        comparison: rule.comparison,
        basis: rule.basis,
    };
}
function validatePolicy(value, clubType) {
    const fields = fieldsFor(clubType);
    if (
        !value ||
        typeof value !== "object" ||
        Array.isArray(value) ||
        typeof value.source !== "string" ||
        !value.source.trim() ||
        value.source.length > 4000
    )
        throw new BadRequest(
            "Record the source clause in the adopted club constitution.",
        );
    if (
        typeof value.suspendedCanVote !== "boolean" ||
        typeof value.arrearsCanVote !== "boolean"
    )
        throw new BadRequest(
            "Specify voting rights for suspended and in-arrears members from the constitution.",
        );
    if (
        !Array.isArray(value.amendmentClasses) ||
        !value.amendmentClasses.length ||
        value.amendmentClasses.length > 20
    )
        throw new BadRequest(
            "Define the amendment classes in your constitution.",
        );
    const seen = new Set(),
        names = new Set();
    const classes = value.amendmentClasses.map((c) => {
        if (
            !c ||
            typeof c.name !== "string" ||
            !c.name.trim() ||
            c.name.length > 80 ||
            names.has(c.name.trim().toLowerCase()) ||
            !Array.isArray(c.fields) ||
            !c.fields.length
        )
            throw new BadRequest(
                "Each amendment class needs a unique name and at least one parameter.",
            );
        names.add(c.name.trim().toLowerCase());
        for (const field of c.fields) {
            if (!fields.includes(field) || seen.has(field))
                throw new BadRequest(
                    "Every supported parameter must belong to exactly one amendment class.",
                );
            seen.add(field);
        }
        return {
            name: c.name.trim(),
            fields: [...c.fields].sort(),
            rule: checkRule(c.rule),
        };
    });
    if (seen.size !== fields.length)
        throw new BadRequest(
            "Assign every supported parameter to an amendment class, including voting rules.",
        );
    return {
        source: value.source.trim(),
        suspendedCanVote: value.suspendedCanVote,
        arrearsCanVote: value.arrearsCanVote,
        general: checkRule(value.general),
        expulsion: checkRule(value.expulsion),
        amendmentClasses: classes,
    };
}
function mayVote(member, policy) {
    return (
        member.standing === "Good standing" ||
        (member.standing === "In arrears" && policy.arrearsCanVote) ||
        (member.standing === "Suspended" && policy.suspendedCanVote)
    );
}
function requiredVotes(rule, { present, eligible, cast }) {
    checkRule(rule);
    const count = { present, eligible, cast }[rule.basis];
    if (!Number.isSafeInteger(count) || count < 0)
        throw new BadRequest("Invalid electorate count.");
    const scaled = count * rule.numerator;
    return rule.comparison === "moreThan"
        ? Math.floor(scaled / rule.denominator) + 1
        : Math.ceil(scaled / rule.denominator);
}
function applicableRules(policy, kind, changes = {}) {
    if (kind === "General") return [{ name: "General", rule: policy.general }];
    if (kind === "Expulsion")
        return [{ name: "Expulsion", rule: policy.expulsion }];
    const fields = Object.keys(changes);
    if (!fields.length || fields.some((f) => !POLICY_FIELDS.includes(f)))
        throw new BadRequest("Choose supported constitution changes.");
    const result = policy.amendmentClasses.filter((c) =>
        c.fields.some((f) => fields.includes(f)),
    );
    if (fields.some((f) => !result.some((c) => c.fields.includes(f))))
        throw new RuleRefusal(
            "The recorded voting policy does not cover these changes.",
        );
    return result.map((c) => ({ name: c.name, rule: c.rule }));
}
function assessVote(input, meeting, rules) {
    if (!meeting.voting_policy || meeting.voter_count == null)
        throw new RuleRefusal(
            "This legacy meeting has no confirmed voting rules. Record a new meeting under the adopted constitution.",
        );
    const votes = [input.votesFor, input.votesAgainst, input.abstentions];
    if (
        votes.some((n) => !Number.isSafeInteger(n) || n < 0) ||
        votes.reduce((a, b) => a + b, 0) !== meeting.voter_count
    )
        throw new BadRequest(
            "Votes must account for every eligible voter present, including abstentions.",
        );
    const facts = {
        present: meeting.voter_count,
        eligible: meeting.eligible_voter_count,
        cast: input.votesFor + input.votesAgainst,
    };
    const required = Math.max(
        ...rules.map((r) => requiredVotes(r.rule, facts)),
    );
    return {
        required,
        outcome: !meeting.quorate
            ? "Advisory"
            : input.votesFor > 0 && input.votesFor >= required
              ? "Carried"
              : "Rejected",
        rules,
    };
}
module.exports = {
    POLICY_FIELDS,
    fieldsFor,
    checkRule,
    validatePolicy,
    mayVote,
    requiredVotes,
    applicableRules,
    assessVote,
};
