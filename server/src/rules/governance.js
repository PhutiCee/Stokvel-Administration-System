"use strict";
const { isIsoDate } = require("../lib/dates");
const { BadRequest, RuleRefusal } = require("../lib/errors");
function text(value, label, max = 20000) {
    if (typeof value !== "string" || !value.trim() || value.length > max)
        throw new BadRequest(
            `${label} is required (maximum ${max} characters).`,
        );
    return value.trim();
}
function meeting(input, eligibleIds, constitution, today) {
    if (!isIsoDate(input.date) || input.date > today)
        throw new BadRequest("Use a valid meeting date, today or earlier.");
    const ids = input.attendance;
    if (
        !Array.isArray(ids) ||
        new Set(ids).size !== ids.length ||
        ids.some((id) => !eligibleIds.includes(id))
    )
        throw new BadRequest(
            "Attendance must contain unique eligible members of this club.",
        );
    if (!eligibleIds.length)
        throw new RuleRefusal("There are no eligible members on this date.");
    const required = Math.ceil(
        (eligibleIds.length * Number(constitution.quorumPercentage)) / 100,
    );
    return {
        date: input.date,
        agenda: text(input.agenda, "Agenda"),
        minutes: text(input.minutes, "Minutes"),
        attendance: ids,
        eligible: eligibleIds.length,
        required,
        quorate: ids.length >= required,
    };
}
function assertEffectable(row) {
    if (row.applied_at)
        throw new RuleRefusal("This resolution has already been given effect.");
    if (row.outcome !== "Carried")
        throw new RuleRefusal(
            "Only a carried resolution from a quorate meeting can be given effect. Advisory and rejected resolutions cannot be applied.",
        );
}
module.exports = { text, meeting, assertEffectable };
