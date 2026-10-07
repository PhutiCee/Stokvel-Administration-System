"use strict";
const { todayIso, isIsoDate } = require("../../lib/dates");

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
 * No response below returns a ledger entry, a contribution, a penalty or a
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
const { BadRequest, Conflict, NotFound, Forbidden } = require("../../lib/errors");

/**
 * REQ-20: aggregate statistics across all clubs, "without disclosing any
 * club-level or member-level detail".
 *
 * Three numbers. Deliberately no breakdown by club, because the requirement
 * forbids one — an administrator who can see per-club totals can infer a great
 * deal about a club's affairs without ever opening its ledger.
 */
async function aggregate(executor = pool) {
  const { rows } = await executor.query(`
      WITH members AS (SELECT standing,count(*)::int AS count FROM member WHERE standing NOT IN ('Exited','Expelled') GROUP BY standing),
      funds AS (SELECT coalesce(o.entry_type,e.entry_type)::text AS category,sum(e.cash_amount)::text AS amount FROM cash_ledger_entry e LEFT JOIN ledger_entry o ON o.club_id=e.club_id AND o.entry_id=e.reverses_id GROUP BY coalesce(o.entry_type,e.entry_type))
      SELECT (SELECT count(*)::int FROM club) AS club_count,
       (SELECT count(*)::int FROM club WHERE status='Active') AS active_clubs,
       (SELECT count(*)::int FROM club WHERE status='Suspended') AS suspended_clubs,
       (SELECT count(*)::int FROM user_account WHERE NOT is_platform_admin) AS account_count,
       coalesce((SELECT jsonb_agg(jsonb_build_object('standing',standing,'count',count) ORDER BY standing) FROM members),'[]'::jsonb) AS members,
       coalesce((SELECT jsonb_agg(jsonb_build_object('category',category,'amount',amount) ORDER BY category) FROM funds),'[]'::jsonb) AS funds
    `);
  const r = rows[0];
  return {
    clubCount: r.club_count,
    activeClubs: r.active_clubs,
    suspendedClubs: r.suspended_clubs,
    accountCount: r.account_count,
    memberCount: r.members.reduce((n, row) => n + row.count, 0),
    fundsUnderAdministration: toNumeric(
      r.funds.reduce((n, row) => n + toCents(row.amount), 0),
    ),
    memberBreakdown: r.members,
    fundsBreakdown: r.funds,
  };
}
async function overview() {
  return require("../../db/tx").withTransaction(async (client) => {
    await client.query(
      "SET TRANSACTION ISOLATION LEVEL REPEATABLE READ, READ ONLY",
    );
    return { stats: await aggregate(client), clubs: await listClubs(client) };
  });
}

/**
 * The club list, for administration only.
 *
 * Identity, type, status, town, size. NO FINANCIAL FIGURES. REQ-18 requires the
 * administrator to be able to suspend a named club, which is impossible without
 * a list of names; REQ-19 and REQ-20 mean that list stops at the point money
 * begins.
 */
async function listClubs(executor = pool) {
  const { rows } = await executor.query(`
        SELECT c.club_id, c.name, c.short_name, c.club_type, c.status, c.town,
               c.registration_date, c.created_at, c.reviewed_at, c.rejection_reason,
               (SELECT count(*)::int FROM member m
                 WHERE m.club_id = c.club_id AND m.standing NOT IN ('Exited','Expelled')) AS member_count
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
    requestedAt: c.created_at,
    reviewedAt: c.reviewed_at,
    rejectionReason: c.rejection_reason,
    memberCount: c.member_count,
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
async function createClub(input, { actor, audit, pendingApproval = false }) {
  if (pendingApproval) {
    await requireChairpersonApplicant(actor);
    const { rows } = await pool.query(
      "SELECT full_name, phone, id_number, email, postal_address FROM user_account WHERE user_id=$1 AND NOT is_platform_admin AND NOT is_system", [actor.userId]);
    const account = rows[0];
    if (!account) throw new Forbidden("A club application needs a member account.");
    input = { ...input, chairperson: { fullName: account.full_name, phone: account.phone,
      idNumber: account.id_number, email: account.email, postalAddress: account.postal_address } };
  } else if (!actor.isPlatformAdmin) {
    throw new Forbidden("Only the Platform Administrator may provision an active club.");
  }
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
    errors["chairperson.phone"] =
      "Enter the chairperson's ten-digit phone number.";
  }
  if (!chair.email?.trim() && !chair.postalAddress?.trim()) {
    errors["chairperson.email"] =
      "Record an email address or a postal address.";
  }

  if (Object.keys(errors).length > 0) {
    throw new BadRequest("Some details need correcting.", { fields: errors });
  }

  const cycleStart = input.cycleStartDate || todayIso();
  if (
    !isIsoDate(cycleStart) ||
    (input.registrationDate && !isIsoDate(input.registrationDate))
  )
    throw new BadRequest(
      "Cycle start and registration dates must be real dates in YYYY-MM-DD format.",
    );
  const client = await pool.connect();

  try {
    await client.query("BEGIN");

    const dup = await client.query(
      "SELECT club_id FROM club WHERE lower(name) = lower($1)",
      [input.name.trim()],
    );
    if (dup.rows[0]) {
      throw new Conflict(
        `A club called "${input.name.trim()}" already exists.`,
      );
    }

    const { rows: clubRows } = await client.query(
      `INSERT INTO club (name, short_name, club_type, town, registration_date, status, requested_by)
             VALUES ($1, $2, $3, $4, COALESCE($5::date, CURRENT_DATE), $6, $7)
             RETURNING club_id, name, club_type, status`,
      [
        input.name.trim(),
        input.shortName.trim(),
        input.clubType,
        input.town?.trim() || null,
        input.registrationDate || null,
        pendingApproval ? "Pending approval" : "Active",
        pendingApproval ? actor.userId : null,
      ],
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
                  waiting_period_days, benefit_schedule,
                  year_end_month, year_end_day, amendment_note, adopted_by)
             VALUES ($1, 1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17)`,
      [
        club.club_id,
        cycleStart,
        toNumeric(toCents(input.contributionAmount)),
        input.cycleFrequency,
        cycleStart,
        toNumeric(toCents(input.penaltyAmount || 0)),
        Number(input.gracePeriodDays ?? 0),
        Number(input.quorumPercentage ?? 50),
        Number(input.exitNoticeDays ?? 30),
        input.clubType === "Rotating" ? input.payoutOrderMethod : null,
        input.forfeitureRule?.trim() || null,
        input.clubType === "Burial" ? Number(input.waitingPeriodDays ?? 0) : 0,
        JSON.stringify(
          input.clubType === "Burial" ? input.benefitSchedule || [] : [],
        ),
        // REQ-79.
        input.clubType === "Accumulating" ? Number(input.yearEndMonth) : null,
        input.clubType === "Accumulating" ? Number(input.yearEndDay) : null,
        "Constitution as adopted at formation.",
        actor.userId,
      ],
    );

    // The founding chairperson. REQ-39: reuse an existing account if this
    // person already belongs to another club.
    const { rows: existing } = await client.query(
      `SELECT user_id, full_name FROM user_account
              WHERE phone = $1 OR ($2::text IS NOT NULL AND id_number = $2) LIMIT 1`,
      [chairPhone, chair.idNumber || null],
    );

    let chairUserId = pendingApproval ? actor.userId : existing[0]?.user_id;
    let tempPassword = null;

    if (!chairUserId) {
      tempPassword = temporaryPassword();
      const { rows: created } = await client.query(
        `INSERT INTO user_account
                     (full_name, id_number, phone, email, postal_address, password_hash)
                 VALUES ($1, $2, $3, $4, $5, $6)
                 RETURNING user_id`,
        [
          chair.fullName.trim(),
          chair.idNumber?.trim() || null,
          chairPhone,
          chair.email?.trim() || null,
          chair.postalAddress?.trim() || null,
          await hashPassword(tempPassword),
        ],
      );
      chairUserId = created[0].user_id;
    }

    const { rows: memberRows } = await client.query(
      `INSERT INTO member (club_id, user_id, role, join_date, queue_position, registered_by)
             VALUES ($1, $2, 'Chairperson', CURRENT_DATE, $3, $4)
             RETURNING member_id`,
      [
        club.club_id,
        chairUserId,
        input.clubType === "Rotating" ? 1 : null,
        actor.userId,
      ],
    );

    await client.query("COMMIT");

    await audit(pendingApproval ? "club.applicationCreated" : "platform.createClub", "Success", {
      clubId: club.club_id,
      detail:
        `${actor.fullName} ${pendingApproval ? "submitted for admin approval" : "provisioned"} ${club.name} (${club.club_type}), ` +
        `chairperson ${chair.fullName}` +
        (existing[0] ? " (existing account reused)" : " (new account created)"),
      targetType: "club",
      targetId: club.club_id,
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
        temporaryPassword: tempPassword,
      },
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
  if (!actor.isPlatformAdmin) throw new Forbidden("Only the Platform Administrator may change club status.");
  const { rows } = await pool.query(
    `UPDATE club SET status = $2, updated_at = now()
          WHERE club_id = $1 AND status = $3
          RETURNING club_id, name, status`,
    [clubId, status, status === "Active" ? "Suspended" : "Active"],
  );
  if (!rows[0]) throw new Conflict("This status change is no longer available. Pending clubs must go through admin review.");

  await audit(
    status === "Suspended" ? "platform.suspendClub" : "platform.reinstateClub",
    "Success",
    {
      clubId,
      detail:
        `${actor.fullName} set ${rows[0].name} to ${status}` +
        (reason ? `. Reason: ${reason}` : ""),
      targetType: "club",
      targetId: clubId,
    },
  );

  return {
    clubId: rows[0].club_id,
    name: rows[0].name,
    status: rows[0].status,
  };
}

const suspendClub = (clubId, opts) => setClubStatus(clubId, "Suspended", opts);
const reinstateClub = (clubId, opts) => setClubStatus(clubId, "Active", opts);

/** Eligibility is account-scoped: selecting a different club cannot grant this right. */
async function requireChairpersonApplicant(actor) {
  if (!actor || actor.isPlatformAdmin) throw new Forbidden("Only an existing club Chairperson may submit an application here.");
  const { rows } = await pool.query(`SELECT 1 FROM member m JOIN club c ON c.club_id=m.club_id
    WHERE m.user_id=$1 AND m.role='Chairperson' AND m.standing NOT IN ('Exited','Expelled','Suspended')
      AND c.status='Active' LIMIT 1`, [actor.userId]);
  if (!rows.length) throw new Forbidden("You must be a Chairperson of an active club to create a club application.");
}

async function reviewClub(clubId, decision, { actor, audit, reason }) {
  if (!actor.isPlatformAdmin) throw new Forbidden("Only the Platform Administrator may review a club.");
  if (!["approve", "reject"].includes(decision)) throw new BadRequest("Choose approve or reject.");
  const rejectionReason = typeof reason === "string" ? reason.trim() : "";
  if (decision === "reject" && (rejectionReason.length < 3 || rejectionReason.length > 2000)) {
    throw new BadRequest("Give a rejection reason between 3 and 2000 characters.");
  }
  const result = await require("../../db/tx").withTransaction(async (client) => {
    const { rows } = await client.query("SELECT * FROM club WHERE club_id=$1 FOR UPDATE", [clubId]);
    const club = rows[0];
    if (!club) throw new NotFound("That club was not found.");
    if (club.status !== "Pending approval") throw new Conflict("Only a club waiting for approval can be reviewed. Refresh the list.");
    if (decision === "approve") {
      const officers = await client.query(`SELECT role FROM member WHERE club_id=$1
        AND role IN ('Chairperson','Treasurer') AND standing NOT IN ('Exited','Expelled','Suspended')`, [clubId]);
      if (!["Chairperson", "Treasurer"].every(role => officers.rows.some(m => m.role === role))) {
        throw new Conflict("The Chairperson must appoint a Treasurer before the club can be approved (REQ-49).");
      }
    }
    const status = decision === "approve" ? "Active" : "Rejected";
    await client.query(`UPDATE club SET status=$2, reviewed_by=$3, reviewed_at=now(), rejection_reason=$4,
      updated_at=now() WHERE club_id=$1`, [clubId, status, actor.userId, decision === "reject" ? rejectionReason : null]);
    // Store the approval audit in the same transaction as activation.
    await client.query(`INSERT INTO audit_log(club_id,user_id,action,outcome,detail,target_type,target_id)
      VALUES($1,$2,$3,'Success',$4,'club',$1)`, [clubId, actor.userId, `platform.${decision}Club`,
      `${actor.fullName} ${decision === "approve" ? "approved" : "rejected"} ${club.name}` + (decision === "reject" ? `: ${rejectionReason}` : "")]);
    return { clubId, name: club.name, status };
  });
  return result;
}

module.exports = {
  requireChairpersonApplicant,
  reviewClub,
  overview,
  aggregate,
  listClubs,
  createClub,
  suspendClub,
  reinstateClub,
};
