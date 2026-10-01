"use strict";

/**
 * Standing engine: SQL only. REQ-44, REQ-101 to REQ-103.
 * The rules live in rules/standing.js; the decisions are made in the service.
 */

/** Every constitution version of the club, with the standing thresholds. */
async function listConstitutionVersions(db, clubId) {
    const { rows } = await db.query(
        `SELECT version,
                to_char(effective_date, 'YYYY-MM-DD') AS "effectiveDate",
                grace_period_days                     AS "gracePeriodDays",
                warning_after_missed                  AS "warningAfterMissed",
                suspension_after_missed               AS "suspensionAfterMissed",
                expulsion_after_missed                AS "expulsionAfterMissed"
           FROM constitution
          WHERE club_id = $1
          ORDER BY version`,
        [clubId]
    );
    return rows;
}

/**
 * Each active member with what they owe as at `today`.
 *
 * A contribution counts as missed when it is not paid in full and its due
 * date plus the grace period has passed (REQ-55: Late from the day after the
 * grace period ends). Computed from the amounts, not the stored status, so it
 * cannot be stale.
 */
async function listMemberPositions(db, clubId, { graceDays, today }) {
    const { rows } = await db.query(
        `SELECT m.member_id AS "memberId",
                m.standing::text AS standing,
                (SELECT COUNT(*)
                   FROM contribution c
                   JOIN cycle cy ON cy.cycle_id = c.cycle_id
                  WHERE c.club_id = m.club_id AND c.member_id = m.member_id
                    AND c.captured_amount < c.expected_amount
                    AND cy.due_date + $2::int < $3::date)::int AS "missedContributions",
                (SELECT COALESCE(SUM(ROUND((c.expected_amount - c.captured_amount) * 100)), 0)
                   FROM contribution c
                   JOIN cycle cy ON cy.cycle_id = c.cycle_id
                  WHERE c.club_id = m.club_id AND c.member_id = m.member_id
                    AND c.captured_amount < c.expected_amount
                    AND cy.due_date + $2::int < $3::date)::bigint AS "arrearsCents",
                (SELECT COALESCE(SUM(ROUND((p.amount - p.settled_amount) * 100)), 0)
                   FROM penalty p
                  WHERE p.club_id = m.club_id AND p.member_id = m.member_id
                    AND p.waived_at IS NULL
                    AND p.settled_amount < p.amount)::bigint AS "penaltiesOutstandingCents"
           FROM member m
          WHERE m.club_id = $1
            AND m.standing IN ('Good standing', 'In arrears', 'Suspended')
          ORDER BY m.member_id`,
        [clubId, graceDays, today]
    );
    return rows;
}

/** Only succeeds if the member is still in the standing we evaluated. */
async function updateStanding(db, clubId, memberId, fromStanding, toStanding) {
    const { rowCount } = await db.query(
        `UPDATE member
            SET standing = $4::member_standing, updated_at = now()
          WHERE club_id = $1 AND member_id = $2 AND standing = $3::member_standing`,
        [clubId, memberId, fromStanding, toStanding]
    );
    return rowCount === 1;
}

async function recordChange(db, { clubId, memberId, from, to, reason, changedOn, changedBy }) {
    await db.query(
        `INSERT INTO standing_change
                (club_id, member_id, from_standing, to_standing, reason, changed_on, changed_by)
         VALUES ($1, $2, $3::member_standing, $4::member_standing, $5, $6::date, $7)`,
        [clubId, memberId, from, to, reason, changedOn, changedBy]
    );
}

/** Newest first. Pass a memberId to see one member's history. */
async function listChanges(db, clubId, { memberId = null, limit = 100 } = {}) {
    const { rows } = await db.query(
        `SELECT change_id AS "changeId", member_id AS "memberId",
                from_standing::text AS "from", to_standing::text AS "to",
                reason, to_char(changed_on, 'YYYY-MM-DD') AS "changedOn",
                changed_by AS "changedBy"
           FROM standing_change
          WHERE club_id = $1 AND ($2::uuid IS NULL OR member_id = $2::uuid)
          ORDER BY created_at DESC
          LIMIT $3`,
        [clubId, memberId, limit]
    );
    return rows;
}

module.exports = { listConstitutionVersions, listMemberPositions, updateStanding, recordChange, listChanges };