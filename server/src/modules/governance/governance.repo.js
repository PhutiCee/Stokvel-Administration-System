"use strict";
async function lockClub(db) {
  return db.one("SELECT club_type FROM club WHERE club_id=$1 FOR UPDATE", [
    db.clubId,
  ]);
}
async function membersOn(db, date) {
  return db.many(
    `SELECT m.member_id, u.full_name, m.role, m.standing FROM member m JOIN user_account u ON u.user_id=m.user_id
        WHERE m.club_id=$1 AND m.join_date <= $2::date AND (m.exit_date IS NULL OR m.exit_date > $2::date)
        AND (m.exit_date IS NOT NULL OR m.standing NOT IN ('Exited','Expelled')) ORDER BY u.full_name`,
    [db.clubId, date],
  );
}
async function listMeetings(db) {
  return db.many(
    `SELECT meeting_id, meeting_date::text, agenda, eligible_count, attendance_count, required_count, quorate
        FROM meeting WHERE club_id=$1 ORDER BY meeting_date DESC, created_at DESC`,
    [db.clubId],
  );
}
async function getMeeting(db, id) {
  return db.one(
    "SELECT *, meeting_date::text FROM meeting WHERE club_id=$1 AND meeting_id=$2",
    [db.clubId, id],
  );
}
async function attendance(db, id) {
  return db.many(
    `SELECT a.member_id, u.full_name FROM meeting_attendance a JOIN member m ON m.club_id=a.club_id AND m.member_id=a.member_id
        JOIN user_account u ON u.user_id=m.user_id WHERE a.club_id=$1 AND a.meeting_id=$2 ORDER BY u.full_name`,
    [db.clubId, id],
  );
}
async function resolutions(db, id) {
  return db.many(
    `SELECT r.*, u.full_name AS subject_name, su.full_name AS successor_name FROM resolution r LEFT JOIN member m ON m.club_id=r.club_id AND m.member_id::text=r.payload->>'memberId' LEFT JOIN user_account u ON u.user_id=m.user_id LEFT JOIN member sm ON sm.club_id=r.club_id AND sm.member_id::text=r.payload->>'successorMemberId' LEFT JOIN user_account su ON su.user_id=sm.user_id WHERE r.club_id=$1 AND r.meeting_id=$2 ORDER BY r.created_at`,
    [db.clubId, id],
  );
}
async function insertMeeting(db, m, c, userId) {
  const row = await db.one(
    `INSERT INTO meeting(club_id,meeting_date,agenda,minutes,constitution_id,eligible_count,attendance_count,required_count,quorate,recorded_by,voting_policy,voter_count,eligible_voter_count,electorate)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14) RETURNING *, meeting_date::text`,
    [
      db.clubId,
      m.date,
      m.agenda,
      m.minutes,
      c.constitutionId,
      m.eligible,
      m.attendance.length,
      m.required,
      m.quorate,
      userId,
      JSON.stringify(m.policy),
      m.voterCount,
      m.eligibleVoters,
      JSON.stringify(m.electorate),
    ],
  );
  for (const id of m.attendance)
    await db.query(
      "INSERT INTO meeting_attendance(club_id,meeting_id,member_id) VALUES($1,$2,$3)",
      [db.clubId, row.meeting_id, id],
    );
  return row;
}
async function insertResolution(db, meetingId, input, check, payload, userId) {
  return db.one(
    `INSERT INTO resolution(club_id,meeting_id,kind,text,votes_for,votes_against,abstentions,required_votes,outcome,payload,recorded_by,proposal_id,voting_rules)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING *`,
    [
      db.clubId,
      meetingId,
      input.kind,
      check.text,
      input.votesFor,
      input.votesAgainst,
      input.abstentions,
      check.required,
      check.outcome,
      JSON.stringify(payload),
      userId,
      input.proposalId || null,
      JSON.stringify(check.rules),
    ],
  );
}
async function getResolution(db, id) {
  return db.one(
    "SELECT * FROM resolution WHERE club_id=$1 AND resolution_id=$2 FOR UPDATE",
    [db.clubId, id],
  );
}
async function markApplied(db, id, userId, versionId) {
  return db.one(
    `UPDATE resolution SET applied_by=$3,applied_at=now(),resulting_constitution_id=$4
    WHERE club_id=$1 AND resolution_id=$2 AND applied_at IS NULL RETURNING *`,
    [db.clubId, id, userId, versionId],
  );
}
async function member(db, id) {
  return db.one(
    "SELECT * FROM member WHERE club_id=$1 AND member_id=$2 FOR UPDATE",
    [db.clubId, id],
  );
}
async function activeRoleCount(db, role) {
  const r = await db.one(
    `SELECT count(*)::int AS n FROM member WHERE club_id=$1 AND role=$2 AND standing NOT IN ('Exited','Expelled')`,
    [db.clubId, role],
  );
  return r.n;
}
async function expel(db, id, date) {
  await db.query(
    `UPDATE member SET standing='Expelled',exit_date=$3,updated_at=now() WHERE club_id=$1 AND member_id=$2`,
    [db.clubId, id, date],
  );
}
module.exports = {
  lockClub,
  membersOn,
  listMeetings,
  getMeeting,
  attendance,
  resolutions,
  insertMeeting,
  insertResolution,
  getResolution,
  markApplied,
  member,
  activeRoleCount,
  expel,
};

async function initialPolicy(db) {
  return db.one(
    "SELECT policy,effective_date::text FROM governance_initial_policy WHERE club_id=$1",
    [db.clubId],
  );
}
async function insertInitialPolicy(db, policy, effectiveDate, userId) {
  return db.one(
    `INSERT INTO governance_initial_policy(club_id,policy,effective_date,recorded_by) VALUES($1,$2,$3,$4) RETURNING club_id`,
    [db.clubId, JSON.stringify(policy), effectiveDate, userId],
  );
}
async function historyStart(db) {
  return db.one(
    `SELECT (min(observed_at) AT TIME ZONE 'Africa/Johannesburg')::date::text AS date FROM governance_member_history WHERE club_id=$1`,
    [db.clubId],
  );
}
async function historicalMembers(db, date) {
  return db.many(
    `SELECT h.member_id,u.full_name,h.role,h.standing FROM
 (SELECT DISTINCT ON(member_id) * FROM governance_member_history WHERE club_id=$1 AND observed_at < (($2::date+1)::timestamp AT TIME ZONE 'Africa/Johannesburg') ORDER BY member_id,observed_at DESC,history_id DESC) h
 JOIN member m ON m.club_id=h.club_id AND m.member_id=h.member_id JOIN user_account u ON u.user_id=m.user_id
 WHERE h.join_date <= $2::date AND (h.exit_date IS NULL OR h.exit_date>$2::date) AND h.standing NOT IN ('Exited','Expelled') ORDER BY u.full_name`,
    [db.clubId, date],
  );
}
async function insertProposal(db, input, baseId, userId) {
  return db.one(
    `INSERT INTO governance_proposal(club_id,base_constitution_id,text,changes,effective_date,proposed_by) VALUES($1,$2,$3,$4,$5,$6) RETURNING *,effective_date::text`,
    [
      db.clubId,
      baseId,
      input.text,
      JSON.stringify(input.changes),
      input.effectiveDate,
      userId,
    ],
  );
}
async function getProposal(db, id) {
  return db.one(
    `SELECT *,effective_date::text,(created_at AT TIME ZONE 'Africa/Johannesburg')::date::text AS proposed_date FROM governance_proposal WHERE club_id=$1 AND proposal_id=$2`,
    [db.clubId, id],
  );
}
async function proposalOutcome(db, id) {
  return db.one(
    `SELECT outcome,applied_at FROM resolution WHERE club_id=$1 AND proposal_id=$2 AND outcome<>'Advisory' ORDER BY created_at DESC LIMIT 1`,
    [db.clubId, id],
  );
}
async function proposals(db) {
  return db.many(
    `SELECT p.*,p.effective_date::text,COALESCE((SELECT CASE WHEN r.applied_at IS NOT NULL THEN 'Applied' ELSE r.outcome END FROM resolution r WHERE r.club_id=p.club_id AND r.proposal_id=p.proposal_id AND r.outcome<>'Advisory' ORDER BY r.created_at DESC LIMIT 1),'Pending') AS status FROM governance_proposal p WHERE p.club_id=$1 ORDER BY p.created_at DESC`,
    [db.clubId],
  );
}
async function appoint(db, memberId, role) {
  return db.query(
    "UPDATE member SET role=$3,updated_at=now() WHERE club_id=$1 AND member_id=$2",
    [db.clubId, memberId, role],
  );
}
Object.assign(module.exports, {
  initialPolicy,
  insertInitialPolicy,
  historyStart,
  historicalMembers,
  insertProposal,
  getProposal,
  proposalOutcome,
  proposals,
  appoint,
});

module.exports.clubType = async (db) =>
  (await db.one("SELECT club_type FROM club WHERE club_id=$1", [db.clubId]))
    .club_type;

// One statement gives the report a consistent snapshot. Reversals are netted
// into their original category; monetary JSON values are explicitly text.
module.exports.annualReport = async (db, start, end) =>
  db.one(
    `
 WITH book AS (
  SELECT e.cash_amount AS amount,e.amount AS assessed_amount,e.posted_at,COALESCE(original.entry_type,e.entry_type)::text AS category
  FROM cash_ledger_entry e LEFT JOIN ledger_entry original ON original.club_id=e.club_id AND original.entry_id=e.reverses_id
  WHERE e.club_id=$1 AND e.posted_at<($3::date::timestamp AT TIME ZONE 'Africa/Johannesburg')
 ), period AS (SELECT * FROM book WHERE posted_at>=($2::date::timestamp AT TIME ZONE 'Africa/Johannesburg'))
 SELECT
 COALESCE((SELECT sum(amount) FROM book WHERE posted_at<($2::date::timestamp AT TIME ZONE 'Africa/Johannesburg')),0)::text AS opening_balance,
 COALESCE((SELECT sum(amount) FROM book),0)::text AS closing_balance,
 COALESCE((SELECT sum(amount) FROM period WHERE category='Contribution'),0)::text AS contributions,
 COALESCE((SELECT sum(assessed_amount) FROM period WHERE category='Penalty'),0)::text AS penalties,
 COALESCE((SELECT -sum(amount) FROM period WHERE category IN ('Payout','Claim')),0)::text AS payouts,
 COALESCE((SELECT sum(amount) FROM period WHERE category NOT IN ('Contribution','Penalty','Payout','Claim')),0)::text AS other_movements,
 (SELECT jsonb_build_object(
   'opening',count(*) FILTER(WHERE join_date<$2::date AND (exit_date IS NULL OR exit_date>=$2::date) AND NOT(standing IN ('Exited','Expelled') AND exit_date IS NULL)),
   'joined',count(*) FILTER(WHERE join_date>=$2::date AND join_date<$3::date AND NOT(standing IN ('Exited','Expelled') AND exit_date IS NULL)),
   'ended',count(*) FILTER(WHERE exit_date>=$2::date AND exit_date<$3::date),
   'closing',count(*) FILTER(WHERE join_date<$3::date AND (exit_date IS NULL OR exit_date>=$3::date) AND NOT(standing IN ('Exited','Expelled') AND exit_date IS NULL)),
   'undatedEnds',count(*) FILTER(WHERE standing IN ('Exited','Expelled') AND exit_date IS NULL AND join_date<$3::date)
 ) FROM member WHERE club_id=$1) AS membership,
 (SELECT jsonb_build_object('date',as_at_date::text,'bankBalance',bank_balance::text,'ledgerBalance',ledger_balance::text,'difference',difference::text,'note',note)
  FROM reconciliation WHERE club_id=$1 AND as_at_date<$3::date ORDER BY as_at_date DESC,recorded_at DESC,reconciliation_id DESC LIMIT 1) AS reconciliation
`,
    [db.clubId, start, end],
  );
