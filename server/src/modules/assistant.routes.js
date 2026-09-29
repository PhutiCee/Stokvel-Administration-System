"use strict";

const express = require("express");
const { requireClubContext } = require("../middleware/tenancy");
const { authorize } = require("../middleware/authorize");
const { asyncRoute } = require("../middleware/errors");
const { BadRequest } = require("../lib/errors");

const router = express.Router();
router.use(requireClubContext);

const OFFICER_ROLES = ["Treasurer", "Secretary", "Chairperson"];

function ownDetailsAnswer(member, contributions, constitution) {
    const value = (field) => member[field] || "Not recorded";
    const lines = [
        "Here are your recorded details:",
        "",
        "### Profile",
        `- **Name:** ${value("full_name")}`,
        `- **Phone:** ${value("phone")}`,
        `- **Email:** ${value("email")}`,
        `- **Postal address:** ${value("postal_address")}`,
        `- **Identity number:** ${value("id_number")}`,
        `- **Active club:** ${value("club_name")}`,
        `- **Club type:** ${value("club_type")}`,
        `- **Club town:** ${value("club_town")}`,
        `- **Role:** ${value("role")}`,
        `- **Joined on:** ${value("join_date")}`,
        `- **Standing:** ${value("standing")}`,
        `- **Queue position:** ${value("queue_position")}`,
        `- **Outstanding amount:** ${value("outstanding")} South African rand`,
        "",
        "### Current club rules",
        `- **Contribution:** ${constitution?.contribution_amount || "Not recorded"} South African rand`,
        `- **Cycle:** ${constitution?.cycle_frequency || "Not recorded"}`,
        `- **Grace period:** ${constitution?.grace_period_days ?? "Not recorded"} days`,
        `- **Penalty:** ${constitution?.penalty_amount || "Not recorded"} South African rand`,
        "",
        "### Recent contributions"
    ];

    lines.push(...contributionsTable(contributions));
    return lines.join("\n");
}

function contributionsTable(contributions) {
    if (contributions.length === 0) return ["No contribution records found."];
    const lines = [
        "| Cycle | Status | Captured | Expected | Due date |",
        "| --- | --- | --- | --- | --- |"
    ];
    for (const contribution of contributions) {
        lines.push(
            `| ${contribution.sequence_number} | ${contribution.status} | ` +
            `${contribution.captured_amount} | ${contribution.expected_amount} | ${contribution.due_date} |`
        );
    }
    return lines;
}

function greetingAnswer(member) {
    const firstName = (member.full_name || "").split(" ")[0] || "there";
    return [
        `Hi ${firstName}! I can answer questions about your own records for **${member.club_name}**.`,
        "",
        "Try asking about:",
        "- Your **profile** or personal details",
        "- Your **balance** or outstanding amount",
        "- Your **queue position**",
        "- Your **contribution history**",
        "- The club's **rules** (contribution amount, cycle, penalties, grace period)",
        "- The club's **pool** total"
    ].join("\n");
}

function balanceAnswer(member) {
    const outstanding = Number(member.outstanding || 0);
    const lines = [
        outstanding > 0
            ? `You currently owe **${member.outstanding} South African rand**.`
            : "You have **no outstanding balance** — your contributions are up to date.",
        "",
        `- **Standing:** ${member.standing || "Not recorded"}`
    ];
    const catchUp = Number(member.catch_up_amount || 0);
    if (catchUp > 0) {
        lines.push(`- **Catch-up amount owing:** ${member.catch_up_amount} South African rand`);
    }
    return lines.join("\n");
}

function queueAnswer(member) {
    if (member.queue_position === null || member.queue_position === undefined) {
        return "You are not on a payout queue for this club.";
    }
    return [
        `Your current **queue position** is **${member.queue_position}**.`,
        `- **Standing:** ${member.standing || "Not recorded"}`
    ].join("\n");
}

function rulesAnswer(constitution) {
    return [
        "### Current club rules",
        `- **Contribution:** ${constitution?.contribution_amount || "Not recorded"} South African rand`,
        `- **Cycle:** ${constitution?.cycle_frequency || "Not recorded"}`,
        `- **Grace period:** ${constitution?.grace_period_days ?? "Not recorded"} days`,
        `- **Penalty:** ${constitution?.penalty_amount || "Not recorded"} South African rand`
    ].join("\n");
}

function cycleAnswer(clubSummary) {
    const cycle = clubSummary.cycleSummary;
    if (!cycle) return "There is no open cycle right now.";
    return [
        "### Current cycle",
        `- **Cycle number:** ${cycle.sequence_number}`,
        `- **Started:** ${cycle.start_date}`,
        `- **Due date:** ${cycle.due_date}`,
        `- **Paid so far:** ${cycle.paid_count} of ${cycle.expected_count} members`,
        `- **Captured:** ${cycle.captured_total} of ${cycle.expected_total} South African rand`
    ].join("\n");
}

function poolAnswer(clubSummary) {
    const pool = clubSummary.poolSummary;
    return [
        "### Club pool",
        `- **Pool balance:** ${pool.pool_balance} South African rand`,
        `- **Ledger entries recorded:** ${pool.ledger_entry_count}`
    ].join("\n");
}

function membersAnswer(clubSummary, role) {
    if (!OFFICER_ROLES.includes(role)) {
        return "That is club-level administrative information available to officers only.";
    }
    const summary = clubSummary.memberSummary;
    return [
        "### Membership summary",
        `- **Total members:** ${summary.member_count}`,
        `- **Good standing:** ${summary.good_standing}`,
        `- **In arrears:** ${summary.in_arrears}`,
        `- **Suspended:** ${summary.suspended}`
    ].join("\n");
}

function fallbackAnswer() {
    return [
        "I do not have enough information to answer that from your records.",
        "",
        "You can ask me about:",
        "- Your **profile** or contact details",
        "- Your **balance** or outstanding amount",
        "- Your **queue position**",
        "- Your **contribution history**",
        "- The current **cycle**",
        "- The club's **rules**",
        "- The club's **pool** total"
    ].join("\n");
}

// Every answer is produced from the signed-in member's own already-fetched
// records — no external service is called. Patterns are checked in order,
// most specific first, so e.g. "queue" is matched before the generic
// balance/rules patterns.
const INTENTS = [
    { test: /^\s*(hi|hey|hello|howzit|good\s?(morning|afternoon|evening))\b/i,
      handle: ({ member }) => greetingAnswer(member) },
    { test: /\b(my|user|profile|personal|contact)\b.*\b(detail|information|record|profile|data)s?\b/i,
      handle: ({ member, contributions, constitution }) => ownDetailsAnswer(member, contributions, constitution) },
    { test: /\b(tell|show|give)\b.*\b(everything|all|thing(?:s)? i need to know|overview|summary)\b/i,
      handle: ({ member, contributions, constitution }) => ownDetailsAnswer(member, contributions, constitution) },
    { test: /\b(queue|payouts?|turn|rotation)\b/i,
      handle: ({ member }) => queueAnswer(member) },
    { test: /\b(balance|owe|owing|outstanding|arrears)\b/i,
      handle: ({ member }) => balanceAnswer(member) },
    { test: /\b(contributions?|payments?|history|paid|receipts?)\b/i,
      handle: ({ contributions }) => ["### Your contribution history", ...contributionsTable(contributions)].join("\n") },
    { test: /\b(current|open|this)\s+cycle\b|\bdue dates?\b/i,
      handle: ({ clubSummary }) => cycleAnswer(clubSummary) },
    { test: /\b(rules?|constitution|penalt(?:y|ies)|grace period|cycles?|frequency)\b/i,
      handle: ({ constitution }) => rulesAnswer(constitution) },
    { test: /\b(pool|funds?)\b/i,
      handle: ({ clubSummary }) => poolAnswer(clubSummary) },
    { test: /\b(member count|how many members|standing count|suspended)\b/i,
      handle: ({ clubSummary, member }) => membersAnswer(clubSummary, member.role) }
];

function answerLocally(question, data) {
    for (const intent of INTENTS) {
        if (intent.test.test(question)) return intent.handle(data);
    }
    return fallbackAnswer();
}

router.post("/", authorize("assistant.ask"), asyncRoute(async (req, res) => {
    const question = String(req.body?.question || "").trim();
    if (!question) throw new BadRequest("Ask a question first.");
    if (question.length > 500) throw new BadRequest("Keep your question under 500 characters.");
    if (!req.actor.memberId) throw new BadRequest("The assistant is available to club members only.");

    const member = await req.db.one(
        `SELECT u.full_name, u.phone, u.email, u.postal_address, u.id_number,
            c.name AS club_name, c.club_type, c.town AS club_town,
            m.role, m.join_date, m.standing, m.queue_position, m.catch_up_amount,
                COALESCE((
                    SELECT sum(expected_amount - captured_amount)
                      FROM contribution
                     WHERE club_id = m.club_id
                       AND member_id = m.member_id
                       AND captured_amount < expected_amount
                ), 0) AS outstanding
           FROM member m
           JOIN user_account u ON u.user_id = m.user_id
           JOIN club c ON c.club_id = m.club_id
          WHERE m.club_id = $1 AND m.member_id = $2`,
        [req.clubId, req.actor.memberId]
    );

    const contributions = await req.db.many(
        `SELECT c.expected_amount, c.captured_amount, c.status,
                cy.sequence_number, cy.due_date
           FROM contribution c
           JOIN cycle cy ON cy.cycle_id = c.cycle_id AND cy.club_id = c.club_id
          WHERE c.club_id = $1 AND c.member_id = $2
          ORDER BY cy.sequence_number DESC
          LIMIT 12`,
        [req.clubId, req.actor.memberId]
    );

    const constitution = await req.db.one(
        `SELECT contribution_amount, cycle_frequency, grace_period_days, penalty_amount
           FROM constitution
          WHERE club_id = $1 AND effective_date <= CURRENT_DATE
          ORDER BY effective_date DESC, version DESC
          LIMIT 1`,
        [req.clubId]
    );

    const [memberSummary, cycleSummary, poolSummary] = await Promise.all([
        req.db.one(
            `SELECT count(*)::int AS member_count,
                    count(*) FILTER (WHERE standing = 'Good standing')::int AS good_standing,
                    count(*) FILTER (WHERE standing = 'In arrears')::int AS in_arrears,
                    count(*) FILTER (WHERE standing = 'Suspended')::int AS suspended
               FROM member
              WHERE club_id = $1 AND standing <> 'Exited'`,
            [req.clubId]
        ),
        req.db.one(
            `SELECT sequence_number, start_date, due_date,
                    count(*)::int AS expected_count,
                    count(*) FILTER (WHERE ct.status = 'Paid')::int AS paid_count,
                    COALESCE(sum(expected_amount), 0) AS expected_total,
                    COALESCE(sum(captured_amount), 0) AS captured_total
               FROM cycle c
               JOIN contribution ct ON ct.cycle_id = c.cycle_id AND ct.club_id = c.club_id
              WHERE c.club_id = $1 AND c.status = 'Open'
              GROUP BY sequence_number, start_date, due_date`,
            [req.clubId]
        ),
        req.db.one(
            `SELECT COALESCE(sum(amount), 0) AS pool_balance,
                    count(*)::int AS ledger_entry_count
               FROM ledger_entry
              WHERE club_id = $1`,
            [req.clubId]
        )
    ]);
    const clubSummary = { memberSummary, cycleSummary, poolSummary };

    const answer = answerLocally(question, { member, contributions, constitution, clubSummary });

    res.json({ answer });
}));

module.exports = router;
