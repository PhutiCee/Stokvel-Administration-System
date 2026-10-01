"use strict";
const lock = (db) =>
  db.one("SELECT * FROM club WHERE club_id=$1 FOR UPDATE", [db.clubId]);
const member = (db, id) =>
  db.one(
    "SELECT m.*,m.join_date::text AS join_date,u.full_name FROM member m JOIN user_account u ON u.user_id=m.user_id WHERE m.club_id=$1 AND m.member_id=$2",
    [db.clubId, id],
  );
const constitution = (db, date) =>
  db.one(
    "SELECT *,cycle_start_date::text AS cycle_start_date FROM constitution WHERE club_id=$1 AND effective_date<=$2 ORDER BY effective_date DESC,version DESC LIMIT 1",
    [db.clubId, date],
  );
const mapping = (db, id) =>
  db.one(
    "SELECT * FROM exit_rule_mapping WHERE club_id=$1 AND constitution_id=$2",
    [db.clubId, id],
  );
const recordMapping = (db, k, policy, user) =>
  db.one(
    "INSERT INTO exit_rule_mapping(club_id,constitution_id,source,policy,recorded_by) VALUES($1,$2,$3,$4::jsonb,$5) RETURNING *",
    [
      db.clubId,
      k.constitution_id,
      k.forfeiture_rule,
      JSON.stringify(policy),
      user,
    ],
  );
const notice = (db, id) =>
  db.one(
    `SELECT n.*,n.notice_date::text,n.earliest_exit::text,m.policy,m.source,k.version,k.cycle_start_date::text
 FROM exit_notice n JOIN exit_rule_mapping m ON m.club_id=n.club_id AND m.mapping_id=n.mapping_id
 JOIN constitution k ON k.club_id=n.club_id AND k.constitution_id=m.constitution_id WHERE n.club_id=$1 AND n.notice_id=$2`,
    [db.clubId, id],
  );
const latest = (db, id) =>
  db.one(
    "SELECT * FROM exit_assessment WHERE club_id=$1 AND notice_id=$2 ORDER BY assessed_at DESC,assessment_id DESC LIMIT 1",
    [db.clubId, id],
  );
const pending = (db, id) =>
  db.one(
    "SELECT notice_id FROM exit_notice WHERE club_id=$1 AND member_id=$2 AND status='Pending'",
    [db.clubId, id],
  );
const create = (db, x) =>
  db.one(
    `INSERT INTO exit_notice(club_id,member_id,notice_date,earliest_exit,mapping_id,requested_by,condition_facts) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb) RETURNING notice_id`,
    [db.clubId, x.memberId, x.today, x.earliest, x.mappingId, x.userId, JSON.stringify(x.conditionFacts || null)],
  );
const assess = (db, id, calculation, user) =>
  db.one(
    "INSERT INTO exit_assessment(club_id,notice_id,calculation,assessed_by) VALUES($1,$2,$3::jsonb,$4) RETURNING *",
    [db.clubId, id, JSON.stringify(calculation), user],
  );
const list = (db, own) =>
  db.many(
    `SELECT n.*,n.notice_date::text,n.earliest_exit::text,u.full_name,
 COALESCE((SELECT jsonb_agg(jsonb_build_object('resolutionId',r.resolution_id,'amount',r.payload->'exitWriteOff'->>'amount','text',r.text,'applied',r.applied_at IS NOT NULL) ORDER BY r.created_at DESC) FROM resolution r WHERE r.club_id=n.club_id AND r.payload->'exitWriteOff'->>'noticeId'=n.notice_id::text AND r.outcome='Carried'),'[]'::jsonb) AS writeoff_resolutions,
 (SELECT row_to_json(a) FROM (SELECT assessment_id,calculation,assessed_at FROM exit_assessment WHERE club_id=n.club_id AND notice_id=n.notice_id ORDER BY assessed_at DESC,assessment_id DESC LIMIT 1)a) AS assessment
 FROM exit_notice n JOIN member m ON m.club_id=n.club_id AND m.member_id=n.member_id JOIN user_account u ON u.user_id=m.user_id
 WHERE n.club_id=$1 AND ($2::uuid IS NULL OR n.member_id=$2) ORDER BY n.created_at DESC,n.notice_id DESC`,
    [db.clubId, own],
  );
const totals = (db, id, start) =>
  db.one(
    `WITH book AS (
 SELECT e.*,coalesce(o.entry_type,e.entry_type) AS kind FROM ledger_entry e LEFT JOIN ledger_entry o ON o.club_id=e.club_id AND o.entry_id=e.reverses_id
 WHERE e.club_id=$1 AND e.posted_at>=($3::date::timestamp AT TIME ZONE 'Africa/Johannesburg') AND e.posted_at<=now())
 SELECT coalesce(sum(amount) FILTER(WHERE member_id=$2 AND kind='Contribution'),0)::text AS contributions,
 coalesce(-sum(amount) FILTER(WHERE member_id=$2 AND kind IN ('Payout','Claim')),0)::text AS paid_out,
 coalesce(sum(amount) FILTER(WHERE kind='Contribution'),0)::text AS club_contributions,
 coalesce(-sum(amount) FILTER(WHERE kind='Expense'),0)::text AS costs,
 (SELECT coalesce(sum(amount-settled_amount),0)::text FROM penalty WHERE club_id=$1 AND member_id=$2 AND waived_at IS NULL) AS penalties,
 (SELECT coalesce(sum(greatest(expected_amount - captured_amount - written_off_amount,0)),0)::text FROM contribution WHERE club_id=$1 AND member_id=$2) AS outstanding
 FROM book`,
    [db.clubId, id, start],
  );
const safeguards = (db, id) =>
  db.one(
    `SELECT
 (SELECT member_id FROM member WHERE club_id=$1 AND queue_position IS NOT NULL AND standing NOT IN ('Exited','Expelled') ORDER BY queue_position LIMIT 1) AS head,
 (SELECT count(*)::int FROM member WHERE club_id=$1 AND role='Chairperson' AND standing NOT IN ('Exited','Expelled')) AS chairs,
 (SELECT count(*)::int FROM member WHERE club_id=$1 AND role='Treasurer' AND standing NOT IN ('Exited','Expelled')) AS treasurers,
 (SELECT count(*)::int FROM payout WHERE club_id=$1 AND member_id=$2 AND status='Initiated') AS pending_payouts`,
    [db.clubId, id],
  );
const endMember = (db, id, today) =>
  db.query(
    "UPDATE member SET standing='Exited',exit_date=$3,credit_amount=0,updated_at=now() WHERE club_id=$1 AND member_id=$2",
    [db.clubId, id, today],
  );
const decide = (db, id, x) =>
  db.one(
    `UPDATE exit_notice SET status=$3,decided_by=$4,decided_at=now(),decision_reason=$5,assessment_id=$6,repayment_entry_id=$7,forfeiture_entry_id=$8,payout_id=$9,writeoff_resolution_id=$10 WHERE club_id=$1 AND notice_id=$2 RETURNING *`,
    [
      db.clubId,
      id,
      x.status,
      x.userId,
      x.reason,
      x.assessmentId || null,
      x.repaymentId || null,
      x.forfeitureId || null,
      x.payoutId || null,
      x.writeoffResolutionId || null,
    ],
  );
async function payout(db, n, assessment, actor) {
  return db.one(
    `INSERT INTO payout(club_id,member_id,payout_type,status,amount,constitution_version,eligibility_rule_applied,assessment_at_initiation,assessment_at_approval,initiated_by,approved_by,approved_at)
 VALUES($1,$2,'Exit settlement','Approved',$3,$4,$5,$6::jsonb,$6::jsonb,$7,$8,now()) RETURNING payout_id`,
    [
      db.clubId,
      n.member_id,
      assessment.calculation.repayable,
      n.version,
      n.source,
      JSON.stringify(assessment.calculation),
      assessment.assessed_by,
      actor,
    ],
  );
}
module.exports = {
  lock,
  member,
  constitution,
  mapping,
  recordMapping,
  notice,
  latest,
  pending,
  create,
  assess,
  list,
  totals,
  safeguards,
  endMember,
  decide,
  payout,
};

module.exports.assessor = (db, userId) =>
  db.one("SELECT role,standing FROM member WHERE club_id=$1 AND user_id=$2", [
    db.clubId,
    userId,
  ]);
module.exports.unpaidPenalties = (db, id) =>
  db.many(
    "SELECT penalty_id,amount::text,settled_amount::text FROM penalty WHERE club_id=$1 AND member_id=$2 AND waived_at IS NULL AND amount>settled_amount ORDER BY levied_at,penalty_id FOR UPDATE",
    [db.clubId, id],
  );
module.exports.settlePenalty = (db, id, amount) =>
  db.query(
    "UPDATE penalty SET settled_amount=$3 WHERE club_id=$1 AND penalty_id=$2",
    [db.clubId, id, amount],
  );

module.exports.conditionFacts = async (db, memberId, evaluatedOn) => {
  const r=await db.one(`SELECT greatest($3::date-m.join_date,0)::int AS "membershipDays",
    (SELECT count(*)::int FROM contribution c JOIN cycle cy ON cy.club_id=c.club_id AND cy.cycle_id=c.cycle_id
     WHERE c.club_id=m.club_id AND c.member_id=m.member_id AND cy.start_date>=m.join_date AND cy.status='Closed'
     AND cy.due_date<=$3::date AND (cy.closed_at AT TIME ZONE 'Africa/Johannesburg')::date<=$3::date
     AND c.written_off_amount=0 AND c.captured_amount>=c.expected_amount) AS "completedPaidCycles"
     FROM member m WHERE m.club_id=$1 AND m.member_id=$2`,[db.clubId,memberId,evaluatedOn]);
  return {...r,evaluatedOn};
};
