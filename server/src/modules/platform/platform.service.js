"use strict";

/**
 * Platform administration. REQ-18, REQ-19, REQ-20, REQ-21.
 *
 *     createClub()     REQ-18, REQ-22 to REQ-29
 *     suspendClub()    REQ-18, REQ-21
 *     reinstateClub()  REQ-18
 *     aggregate()      REQ-20
 *
 * THIS IS THE ONE MODULE THAT WORKS ACROSS CLUBS, and every query in it is
 * therefore written against the shared pool rather than a club-scoped wrapper.
 * That is legitimate here and nowhere else: the platform administrator's whole
 * job is the estate of clubs, not any one of them.
 *
 * What the administrator may NOT see is tightly bounded by REQ-19 and REQ-20.
 * Not one query below reads a ledger entry, a contribution, a penalty or a
 * member's name. The aggregate figures are sums across the whole platform, and
 * the club list carries identity and status only — never money. An administrator
 * can tell you the platform holds R25,360 under administration; they cannot tell
 * you which club holds what, or who paid it.
 */

const { pool } = require("../../db/pool");
const { hashPassword } = require("../../lib/password");
const { temporaryPassword } = require("../../lib/tempPassword");
const { normalisePhone } = require("../auth/auth.repo");
const { validateConsistency } = require("../../rules/constitution");
const { toNumeric, toCents } = require("../../lib/money");
const { BadRequest, Conflict, NotFound } = require("../../lib/errors");

/**
 * REQ-20: aggregate statistics across all clubs, "without disclosing any
 * club-level or member-level detail".
 *
 * Three numbers. Deliberately no breakdown by club, because the requirement
 * forbids one — an administrator who can see per-club totals can infer a great
 * deal about a club's affairs without ever opening its ledger.
 */
async function aggregate() {
    const { rows } = await pool.query(`
        SELECT
            (SELECT count(*)::int FROM club)                                   AS club_count,
            (SELECT count(*)::int FROM club WHERE status = 'Active')           AS active_clubs,
            (SELECT count(*)::int FROM club WHERE status = 'Suspended')        AS suspended_clubs,
            (SELECT count(*)::int FROM member WHERE standing <> 'Exited')      AS member_count,
            (SELECT count(*)::int FROM user_account WHERE NOT is_platform_admin) AS account_count,
            (SELECT COALESCE(sum(amount), 0) FROM ledger_entry)                AS funds_under_administration
    `);
    const r = rows[0];
    return {
        clubCount: r.club_count,
        activeClubs: r.active_clubs,
        suspendedClubs: r.suspended_clubs,
        memberCount: r.member_count,
        accountCount: r.account_count,
        fundsUnderAdministration: r.funds_under_administration
    };
}

/**
 * The club list, for administration only.
 *
 * Identity, type, status, town, size. NO FINANCIAL FIGURES. REQ-18 requires the
 * administrator to be able to suspend a named club, which is impossible without
 * a list of names; REQ-19 and REQ-20 mean that list stops at the point money
 * begins.
 */
async function listClubs() {
    const { rows } = await pool.query(`
        SELECT c.club_id, c.name, c.short_name, c.club_type, c.status, c.town,
               c.registration_date,
               (SELECT count(*)::int FROM member m
                 WHERE m.club_id = c.club_id AND m.standing <> 'Exited') AS member_count
          FROM club c
         ORDER BY c.status, c.name
    `);
    return rows.map((c) => ({
        clubId: c.club_id,
        name: c.name,
        shortName: c.short_name,
        clubType: c.club_type,
        status: c.status,
        town: c.town,
        registrationDate: c.registration_date,
        memberCount: c.member_count
    }));
}

/**
 * createClub() — REQ-18, and REQ-22 to REQ-29 for the constitution.
 *
 * Provisioning creates three things in one transaction: the club, version 1 of
 * its constitution, and the founding Chairperson.
 *
 * The Chairperson is not optional. REQ-49 requires a club to have one at all
 * times, so a club created without one would be born in a state the rules
 * forbid. Creating them together means that state never exists.
 */
async function createClub(input, { actor, audit }) {
    const errors = {};

    if (!input.name || input.name.trim().length < 3) {
        errors.name = "Give the club its full name.";
    }
    if (!input.shortName || !input.shortName.trim()) {
        errors.shortName = "Give a short name for headings and lists.";
    }

    // REQ-29, plus REQ-22 to REQ-28.
    const constitutionCheck = validateConsistency(input);
    Object.assign(errors, constitutionCheck.errors);

    // The founding chairperson.
    const chair = input.chairperson || {};
    const chairPhone = normalisePhone(chair.phone);
    if (!chair.fullName || chair.fullName.trim().length < 3) {
        errors["chairperson.fullName"] = "Name the club's chairperson.";
    }
    if (!chairPhone || !/^0\d{9}$/.test(chairPhone)) {
        errors["chairperson.phone"] = "Enter the chairperson's ten-digit phone number.";
    }
    if (!chair.email?.trim() && !chair.postalAddress?.trim()) {
        errors["chairperson.email"] = "Record an email address or a postal address.";
    }

    if (Object.keys(errors).length > 0) {
        throw new BadRequest("Some details need correcting.", { fields: errors });
    }

    const cycleStart = input.cycleStartDate || new Date().toISOString().slice(0, 10);
    const client = await pool.connect();

    try {
        await client.query("BEGIN");

        const dup = await client.query(
            "SELECT club_id FROM club WHERE lower(name) = lower($1)",
            [input.name.trim()]
        );
        if (dup.rows[0]) {
            throw new Conflict(`A club called "${input.name.trim()}" already exists.`);
        }

        const { rows: clubRows } = await client.query(
            `INSERT INTO club (name, short_name, club_type, town, registration_date)
             VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE))
             RETURNING club_id, name, club_type, status`,
            [input.name.trim(), input.shortName.trim(), input.clubType,
             input.town?.trim() || null, input.registrationDate || null]
        );
        const club = clubRows[0];

        // Version 1 of the constitution. Amendments create new versions rather
        // than editing this row (REQ-30), so this one survives for as long as
        // the club does.
        await client.query(
            `INSERT INTO constitution
                 (club_id, version, effective_date, contribution_amount,
                  cycle_frequency, cycle_start_date, penalty_amount,
                  grace_period_days, quorum_percentage, exit_notice_days,
                  payout_order_method, forfeiture_rule,
                  waiting_period_days, benefit_schedule, amendment_note, adopted_by)
             VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)`,
            [club.club_id, cycleStart,
             toNumeric(toCents(input.contributionAmount)),
             input.cycleFrequency, cycleStart,
             toNumeric(toCents(input.penaltyAmount || 0)),
             Number(input.gracePeriodDays ?? 0),
             Number(input.quorumPercentage ?? 50),
             Number(input.exitNoticeDays ?? 30),
             input.clubType === "Rotating" ? input.payoutOrderMethod : null,
             input.forfeitureRule?.trim() || null,
             input.clubType === "Burial" ? Number(input.waitingPeriodDays ?? 0) : 0,
             JSON.stringify(input.clubType === "Burial" ? (input.benefitSchedule || []) : []),
             "Constitution as adopted at formation.",
             actor.userId]
        );

        // The founding chairperson. REQ-39: reuse an existing account if this
        // person already belongs to another club.
        const { rows: existing } = await client.query(
            `SELECT user_id, full_name FROM user_account
              WHERE phone = $1 OR ($2::text IS NOT NULL AND id_number = $2) LIMIT 1`,
            [chairPhone, chair.idNumber || null]
        );

        let chairUserId = existing[0]?.user_id;
        let tempPassword = null;

        if (!chairUserId) {
            tempPassword = temporaryPassword();
            const { rows: created } = await client.query(
                `INSERT INTO user_account
                     (full_name, id_number, phone, email, postal_address, password_hash)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING user_id`,
                [chair.fullName.trim(), chair.idNumber?.trim() || null, chairPhone,
                 chair.email?.trim() || null, chair.postalAddress?.trim() || null,
                 await hashPassword(tempPassword)]
            );
            chairUserId = created[0].user_id;
        }

        const { rows: memberRows } = await client.query(
            `INSERT INTO member (club_id, user_id, role, join_date, queue_position, registered_by)
             VALUES ($1, $2, 'Chairperson', CURRENT_DATE, $3, $4)
             RETURNING member_id`,
            [club.club_id, chairUserId,
             input.clubType === "Rotating" ? 1 : null, actor.userId]
        );

        await client.query("COMMIT");

        await audit("platform.createClub", "Success", {
            clubId: club.club_id,
            detail:
                `${actor.fullName} provisioned ${club.name} (${club.club_type}), ` +
                `chairperson ${chair.fullName}` +
                (existing[0] ? " (existing account reused)" : " (new account created)"),
            targetType: "club",
            targetId: club.club_id
        });

        return {
            clubId: club.club_id,
            name: club.name,
            clubType: club.club_type,
            status: club.status,
            chairperson: {
                memberId: memberRows[0].member_id,
                fullName: chair.fullName.trim(),
                phone: chairPhone,
                reusedAccount: !!existing[0],
                temporaryPassword: tempPassword
            }
        };
    } catch (err) {
        await client.query("ROLLBACK");
        throw err;
    } finally {
        client.release();
    }
}

/** REQ-18, REQ-21. */
async function setClubStatus(clubId, status, { actor, audit, reason }) {
    const { rows } = await pool.query(
        `UPDATE club SET status = $2, updated_at = now()
          WHERE club_id = $1
          RETURNING club_id, name, status`,
        [clubId, status]
    );
    if (!rows[0]) throw new NotFound("That club was not found.");

    await audit(status === "Suspended" ? "platform.suspendClub" : "platform.reinstateClub",
        "Success", {
            clubId,
            detail: `${actor.fullName} set ${rows[0].name} to ${status}` +
                    (reason ? `. Reason: ${reason}` : ""),
            targetType: "club",
            targetId: clubId
        });

    return { clubId: rows[0].club_id, name: rows[0].name, status: rows[0].status };
}

const suspendClub = (clubId, opts) => setClubStatus(clubId, "Suspended", opts);
const reinstateClub = (clubId, opts) => setClubStatus(clubId, "Active", opts);

module.exports = { aggregate, listClubs, createClub, suspendClub, reinstateClub };