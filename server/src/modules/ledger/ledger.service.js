"use strict";

/**
 * Ledger service. SRS 4.4.9.
 *
 *     appendEntry()     REQ-88, REQ-89, REQ-90
 *     getPoolBalance()  REQ-92
 *
 * Every function here MUST be called inside a transaction, with the client
 * passed in. A ledger entry that persists without the contribution it records,
 * or the other way round, is a corrupt book — SDD 5.2.2 requires the pair to be
 * atomic, and the only way to guarantee that is for the caller to own the
 * transaction.
 */

const { toCents, toNumeric } = require("../../lib/money");

/**
 * appendEntry() — add one line to the book.
 *
 * THE LOCK IS THE IMPORTANT PART OF THIS FUNCTION.
 *
 * Each entry stores the pool balance as it stood immediately after that entry,
 * so a statement can be printed without recomputing the whole book, and so a
 * break in the running balance is visible evidence of tampering.
 *
 * Computing that figure means reading the current balance and then writing a
 * new row. Two treasurers capturing payments at the same moment would both read
 * the same starting balance and both write a row claiming to be the next one.
 * The pool total would still be right — it is a sum — but the running balance
 * column would contain two rows with the same figure and a gap afterwards, and
 * the book would look falsified when it was merely raced.
 *
 * So the club row is locked FOR UPDATE first. Concurrent captures against the
 * same club queue up behind it; captures against DIFFERENT clubs are unaffected,
 * because they lock different rows.
 *
 * @param {object} client  a pg client already inside a transaction
 */
async function appendEntry(
  client,
  {
    clubId,
    memberId = null,
    entryType,
    amount,
    description,
    reference = null,
    postedBy,
    reversesId = null,
    reason = null,
    contributionId = null,
    penaltyId = null,
    postedAt = null,
  },
) {
  if (!clubId) throw new Error("appendEntry requires a club.");
  if (!postedBy)
    throw new Error("appendEntry requires the user posting the entry.");

  // Serialise entries for this club. Everything below runs alone.
  await client.query("SELECT club_id FROM club WHERE club_id = $1 FOR UPDATE", [
    clubId,
  ]);

  const { rows: balanceRows } = await client.query(
    "SELECT COALESCE(sum(amount), 0) AS balance FROM ledger_entry WHERE club_id = $1",
    [clubId],
  );

  const amountCents = toCents(amount);
  const resultingCents = toCents(balanceRows[0].balance) + amountCents;

  const { rows } = await client.query(
    `INSERT INTO ledger_entry
             (club_id, member_id, entry_type, amount, resulting_balance,
              description, reference, reverses_id, reason,
              contribution_id, penalty_id, posted_by, posted_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
                 COALESCE($13::timestamptz, now()))
         RETURNING entry_id, amount, resulting_balance, posted_at`,
    [
      clubId,
      memberId,
      entryType,
      toNumeric(amountCents),
      toNumeric(resultingCents),
      description,
      reference,
      reversesId,
      reason,
      contributionId,
      penaltyId,
      postedBy,
      postedAt,
    ],
  );

  return {
    entryId: rows[0].entry_id,
    amount: rows[0].amount,
    resultingBalance: rows[0].resulting_balance,
    postedAt: rows[0].posted_at,
  };
}

/**
 * getPoolBalance() — REQ-92.
 *
 * Summed from the ledger every time. There is no stored balance on the club,
 * deliberately: a second figure that can drift from the book is a second source
 * of truth, and when the two disagree there is no way to tell from the data
 * which one is lying. See docs/decisions.md, decision 2.
 */
async function getPoolBalance(db) {
  const row = await db.one(
    `SELECT COALESCE(sum(amount), 0) AS balance,
                count(*)::int             AS entries
           FROM ledger_entry WHERE club_id = $1`,
    [db.clubId],
  );
  return { balance: row.balance, entryCount: row.entries };
}

/** A member's own running total within the club. */
async function getMemberPosition(db, memberId) {
  const row = await db.one(
    `SELECT COALESCE(sum(amount) FILTER (WHERE amount > 0), 0) AS paid_in,
                COALESCE(sum(amount) FILTER (WHERE amount < 0), 0) AS paid_out,
                count(*)::int AS entries
           FROM ledger_entry
          WHERE club_id = $1 AND member_id = $2`,
    [db.clubId, memberId],
  );
  return {
    paidIn: row.paid_in,
    paidOut: row.paid_out,
    entryCount: row.entries,
  };
}

async function listEntries(db, { memberId = null, limit = 100 } = {}) {
  return db.many(
    `SELECT l.entry_id, l.entry_type, l.amount, l.resulting_balance,
                l.description, l.reference, l.reverses_id, l.reason, l.posted_at,
                u.full_name AS posted_by_name,
                mu.full_name AS member_name
           FROM ledger_entry l
           JOIN user_account u ON u.user_id = l.posted_by
           LEFT JOIN member m   ON m.member_id = l.member_id AND m.club_id = l.club_id
           LEFT JOIN user_account mu ON mu.user_id = m.user_id
          WHERE l.club_id = $1
            AND ($2::uuid IS NULL OR l.member_id = $2)
          ORDER BY l.posted_at DESC, l.entry_id DESC
          LIMIT $3`,
    [db.clubId, memberId, limit],
  );
}

/**
 * generateMemberStatement() — REQ-94.
 *
 * "Every contribution, penalty, waiver and payout affecting them, in
 * chronological order, with a running balance."
 *
 * Note the direction of the running balance here. The club ledger runs newest
 * first, because a treasurer wants today at the top. A member statement runs
 * OLDEST first, because a person reading their own history reads it forward —
 * this is what they paid in January, then February, and here is where it stands
 * now. The running balance is the member's own cumulative position, not the
 * club pool: it answers "what have I put in and taken out", which is the
 * question the statement exists to answer.
 */
async function generateMemberStatement(db, memberId) {
  const member = await db.one(
    `SELECT m.member_id, m.role, m.standing, m.join_date, m.queue_position,
                m.catch_up_amount, m.credit_amount,
                u.full_name, u.phone,
                c.name AS club_name, c.club_type
           FROM member m
           JOIN user_account u ON u.user_id = m.user_id
           JOIN club c         ON c.club_id = m.club_id
          WHERE m.club_id = $1 AND m.member_id = $2`,
    [db.clubId, memberId],
  );
  if (!member) return null;

  const entries = await db.many(
    `SELECT l.entry_id, l.entry_type, l.amount, l.description, l.reference,
                l.reverses_id, l.reason, l.posted_at,
                u.full_name AS posted_by_name
           FROM ledger_entry l
           JOIN user_account u ON u.user_id = l.posted_by
          WHERE l.club_id = $1 AND l.member_id = $2
          ORDER BY l.posted_at ASC, l.entry_id ASC`,
    [db.clubId, memberId],
  );

  // The running balance is computed here rather than read from
  // resulting_balance, because that column tracks the CLUB pool, not this
  // member's position. Using it would show a member the club's balance and
  // call it theirs.
  let runningCents = 0;
  const lines = entries.map((e) => {
    runningCents += toCents(e.amount);
    return {
      entryId: e.entry_id,
      entryType: e.entry_type,
      amount: e.amount,
      runningTotal: toNumeric(runningCents),
      description: e.description,
      reference: e.reference,
      isReversal: !!e.reverses_id,
      reason: e.reason,
      postedAt: e.posted_at,
      postedByName: e.posted_by_name,
    };
  });

  const paidInCents = entries
    .filter((e) => toCents(e.amount) > 0)
    .reduce((sum, e) => sum + toCents(e.amount), 0);
  const paidOutCents = entries
    .filter((e) => toCents(e.amount) < 0)
    .reduce((sum, e) => sum + toCents(e.amount), 0);

  // Outstanding contributions, so the statement answers "do I owe anything"
  // as well as "what have I paid".
  const owing = await db.one(
    `SELECT COALESCE(sum(expected_amount - captured_amount), 0) AS outstanding,
                count(*) FILTER (WHERE captured_amount < expected_amount)::int AS unpaid_cycles
           FROM contribution
          WHERE club_id = $1 AND member_id = $2 AND captured_amount < expected_amount`,
    [db.clubId, memberId],
  );

  const penalties = await db.one(
    `SELECT COALESCE(sum(amount - settled_amount) FILTER (WHERE waived_at IS NULL), 0) AS unsettled,
                COALESCE(sum(amount) FILTER (WHERE waived_at IS NOT NULL), 0) AS waived
           FROM penalty
          WHERE club_id = $1 AND member_id = $2`,
    [db.clubId, memberId],
  );

  return {
    member: {
      memberId: member.member_id,
      fullName: member.full_name,
      phone: member.phone,
      role: member.role,
      standing: member.standing,
      joinDate: member.join_date,
      queuePosition: member.queue_position,
      catchUpAmount: member.catch_up_amount,
      creditAmount: member.credit_amount,
    },
    club: { name: member.club_name, clubType: member.club_type },
    lines,
    summary: {
      paidIn: toNumeric(paidInCents),
      paidOut: toNumeric(Math.abs(paidOutCents)),
      netPosition: toNumeric(paidInCents + paidOutCents),
      outstanding: owing.outstanding,
      unpaidCycles: owing.unpaid_cycles,
      unsettledPenalties: penalties.unsettled,
      waivedPenalties: penalties.waived,
      entryCount: lines.length,
    },
    generatedAt: new Date().toISOString(),
  };
}

module.exports = {
  appendEntry,
  getPoolBalance,
  getMemberPosition,
  listEntries,
  generateMemberStatement,
};