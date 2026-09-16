"use strict";

/**
 * Club routes.
 *
 *   GET /api/club               the active club, its constitution and a summary
 *   GET /api/club/constitution  the constitution in force today
 *
 * Singular, not /api/clubs, because there is only ever one club in scope: the
 * one on the session. There is no route that lists clubs, by design — the only
 * cross-club query in the system is listClubMemberships, and it is scoped by
 * user_id.
 */

const express = require("express");
const { requireClubContext } = require("../../middleware/tenancy");
const { authorize } = require("../../middleware/authorize");
const { asyncRoute } = require("../../middleware/errors");

const router = express.Router();

router.use(requireClubContext);

/** The constitution in force on a given date (REQ-30, REQ-86). */
async function constitutionInForceOn(db, date = "CURRENT_DATE") {
    return db.one(
        `SELECT * FROM constitution
          WHERE club_id = $1 AND effective_date <= ${date === "CURRENT_DATE" ? "CURRENT_DATE" : "$2"}
          ORDER BY effective_date DESC, version DESC
          LIMIT 1`,
        date === "CURRENT_DATE" ? [db.clubId] : [db.clubId, date]
    );
}

function presentConstitution(c) {
    if (!c) return null;
    return {
        constitutionId: c.constitution_id,
        version: c.version,
        effectiveDate: c.effective_date,
        contributionAmount: c.contribution_amount,
        cycleFrequency: c.cycle_frequency,
        cycleStartDate: c.cycle_start_date,
        penaltyAmount: c.penalty_amount,
        gracePeriodDays: c.grace_period_days,
        quorumPercentage: c.quorum_percentage,
        exitNoticeDays: c.exit_notice_days,
        payoutOrderMethod: c.payout_order_method,
        forfeitureRule: c.forfeiture_rule,
        waitingPeriodDays: c.waiting_period_days,
        benefitSchedule: c.benefit_schedule
    };
}

// ---------------------------------------------------------------------------
// GET /api/club
// ---------------------------------------------------------------------------
// Everything the dashboard needs, in one request. Assembled server-side rather
// than as four round trips, because a member on a modest phone over metered
// data pays for each one.
router.get("/", authorize("view.dashboard"), asyncRoute(async (req, res) => {
    const db = req.db;

    const [club, constitution, counts, cycle, balance] = await Promise.all([
        db.one(
            `SELECT club_id, name, short_name, club_type, status, town, registration_date
               FROM club WHERE club_id = $1`,
            [db.clubId]
        ),
        constitutionInForceOn(db),
        db.one(
            `SELECT count(*)::int AS total,
                    count(*) FILTER (WHERE standing = 'Good standing')::int AS good,
                    count(*) FILTER (WHERE standing = 'In arrears')::int     AS arrears,
                    count(*) FILTER (WHERE standing = 'Suspended')::int      AS suspended
               FROM member
              WHERE club_id = $1 AND standing <> 'Exited'`,
            [db.clubId]
        ),
        db.one(
            `SELECT c.cycle_id, c.sequence_number, c.start_date, c.due_date,
                    count(ct.*)::int AS expected_count,
                    count(*) FILTER (WHERE ct.status = 'Paid')::int AS paid_count,
                    COALESCE(sum(ct.expected_amount), 0) AS expected_total,
                    COALESCE(sum(ct.captured_amount), 0) AS captured_total
               FROM cycle c
               LEFT JOIN contribution ct
                      ON ct.cycle_id = c.cycle_id AND ct.club_id = c.club_id
              WHERE c.club_id = $1 AND c.status = 'Open'
              GROUP BY c.cycle_id, c.sequence_number, c.start_date, c.due_date`,
            [db.clubId]
        ),
        // getPoolBalance(). The ledger is the only source of truth for this
        // figure — there is no stored balance to disagree with it.
        db.one(
            `SELECT COALESCE(sum(amount), 0) AS pool_balance,
                    count(*)::int AS entry_count
               FROM ledger_entry WHERE club_id = $1`,
            [db.clubId]
        )
    ]);

    // The member's own position. Everyone sees this, whatever their role.
    const own = req.actor.memberId
        ? await db.one(
            `SELECT m.standing, m.queue_position, m.join_date, m.catch_up_amount,
                    COALESCE((
                        SELECT sum(c.expected_amount - c.captured_amount)
                          FROM contribution c
                         WHERE c.club_id = m.club_id
                           AND c.member_id = m.member_id
                           AND c.captured_amount < c.expected_amount
                    ), 0) AS outstanding
               FROM member m
              WHERE m.club_id = $1 AND m.member_id = $2`,
            [db.clubId, req.actor.memberId]
        )
        : null;

    res.json({
        club: {
            clubId: club.club_id,
            name: club.name,
            shortName: club.short_name,
            clubType: club.club_type,
            status: club.status,
            town: club.town,
            registrationDate: club.registration_date
        },
        constitution: presentConstitution(constitution),
        members: counts,
        openCycle: cycle
            ? {
                cycleId: cycle.cycle_id,
                sequenceNumber: cycle.sequence_number,
                startDate: cycle.start_date,
                dueDate: cycle.due_date,
                expectedCount: cycle.expected_count,
                paidCount: cycle.paid_count,
                expectedTotal: cycle.expected_total,
                capturedTotal: cycle.captured_total
            }
            : null,
        poolBalance: balance.pool_balance,
        ledgerEntryCount: balance.entry_count,
        own: own
            ? {
                standing: own.standing,
                queuePosition: own.queue_position,
                joinDate: own.join_date,
                catchUpAmount: own.catch_up_amount,
                outstanding: own.outstanding
            }
            : null
    });
}));

// ---------------------------------------------------------------------------
// GET /api/club/constitution
// ---------------------------------------------------------------------------
router.get("/constitution", authorize("view.constitution"), asyncRoute(async (req, res) => {
    const c = await constitutionInForceOn(req.db);
    res.json({ constitution: presentConstitution(c) });
}));

module.exports = router;
module.exports.constitutionInForceOn = constitutionInForceOn;