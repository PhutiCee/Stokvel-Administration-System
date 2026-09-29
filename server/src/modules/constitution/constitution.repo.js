"use strict";

/**
 * Constitution repo. SQL only, no rules.
 *
 * Dates are selected as text (effective_date::text) so that they reach the
 * rules engine as YYYY-MM-DD and never pass through a JavaScript Date. See
 * lib/dates.js for why.
 */

const COLUMNS = `
    constitution_id, version,
    effective_date::text    AS effective_date,
    contribution_amount, cycle_frequency,
    cycle_start_date::text  AS cycle_start_date,
    penalty_amount, grace_period_days, quorum_percentage, exit_notice_days,
    payout_order_method, forfeiture_rule, waiting_period_days, benefit_schedule,
    year_end_month, year_end_day,
    amendment_note, adopted_by, created_at`;

function present(r) {
    return {
        constitutionId: r.constitution_id,
        version: r.version,
        effectiveDate: r.effective_date,
        contributionAmount: r.contribution_amount,
        cycleFrequency: r.cycle_frequency,
        cycleStartDate: r.cycle_start_date,
        penaltyAmount: r.penalty_amount,
        gracePeriodDays: r.grace_period_days,
        quorumPercentage: r.quorum_percentage,
        exitNoticeDays: r.exit_notice_days,
        payoutOrderMethod: r.payout_order_method,
        forfeitureRule: r.forfeiture_rule,
        waitingPeriodDays: r.waiting_period_days,
        benefitSchedule: r.benefit_schedule,
        yearEndMonth: r.year_end_month,
        yearEndDay: r.year_end_day,
        amendmentNote: r.amendment_note,
        adoptedBy: r.adopted_by,
        createdAt: r.created_at
    };
}

/** Every version this club has ever had, oldest first. */
async function listVersions(db) {
    const rows = await db.many(
        `SELECT ${COLUMNS} FROM constitution
          WHERE club_id = $1
          ORDER BY version ASC`,
        [db.clubId]
    );
    return rows.map(present);
}

/** Locks the club row so that two amendments cannot be recorded at once. */
async function lockClub(db) {
    return db.one(
        `SELECT club_id, club_type FROM club WHERE club_id = $1 FOR UPDATE`,
        [db.clubId]
    );
}

async function insertVersion(db, v) {
    const row = await db.one(
        `INSERT INTO constitution
             (club_id, version, effective_date, contribution_amount,
              cycle_frequency, cycle_start_date, penalty_amount,
              grace_period_days, quorum_percentage, exit_notice_days,
              payout_order_method, forfeiture_rule,
              waiting_period_days, benefit_schedule,
              year_end_month, year_end_day, amendment_note, adopted_by)
         VALUES ($1, $2, $3::date, $4, $5, $6::date, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18)
         RETURNING ${COLUMNS}`,
        [db.clubId, v.version, v.effectiveDate, v.contributionAmount,
         v.cycleFrequency, v.cycleStartDate, v.penaltyAmount,
         v.gracePeriodDays, v.quorumPercentage, v.exitNoticeDays,
         v.payoutOrderMethod, v.forfeitureRule,
         v.waitingPeriodDays, JSON.stringify(v.benefitSchedule),
         v.yearEndMonth, v.yearEndDay,
         v.amendmentNote, v.adoptedBy]
    );
    return present(row);
}

module.exports = { listVersions, lockClub, insertVersion };