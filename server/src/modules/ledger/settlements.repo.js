"use strict";
const requests = require('./reversals.repo');
const {RuleRefusal} = require('../../lib/errors');
const {toCents,toNumeric} = require('../../lib/money');
const queue = require('../queue/queue.repo');
const queueIds = async db => (await queue.listQueueRows(db)).map(m=>m.member_id);
async function identify(db,e) {
  if(e.payout_id) {
    const p=await db.one('SELECT * FROM payout WHERE club_id=$1 AND payout_id=$2',[db.clubId,e.payout_id]);
    if(p?.distribution_id) return {scope:'Distribution',targetId:p.distribution_id};
  }
  const n=await db.one('SELECT notice_id FROM exit_notice WHERE club_id=$1 AND (repayment_entry_id=$2 OR forfeiture_entry_id=$2)',[db.clubId,e.entry_id]);
  return n ? {scope:'Exit settlement',targetId:n.notice_id} : null;
}
async function entries(db,bundle) {
  if(bundle.scope==='Distribution') return db.many(`SELECT e.* FROM ledger_entry e JOIN payout p ON p.club_id=e.club_id AND p.payout_id=e.payout_id
    WHERE e.club_id=$1 AND p.distribution_id=$2 AND e.reverses_id IS NULL ORDER BY e.entry_id`,[db.clubId,bundle.targetId]);
  return db.many(`SELECT e.* FROM ledger_entry e JOIN exit_notice n ON n.club_id=e.club_id AND e.entry_id IN(n.repayment_entry_id,n.forfeiture_entry_id)
    WHERE e.club_id=$1 AND n.notice_id=$2 ORDER BY e.entry_id`,[db.clubId,bundle.targetId]);
}
async function check(db,bundle) {
  if(bundle.scope==='Distribution') {
    const d=await db.one('SELECT * FROM distribution WHERE club_id=$1 AND distribution_id=$2',[db.clubId,bundle.targetId]);
    if(!d || d.status!=='Approved' || d.reversed_by_request_id)throw new RuleRefusal('Only an approved, unreversed distribution can be corrected.');
    if(await db.one("SELECT distribution_id FROM distribution WHERE club_id=$1 AND distribution_id<>$2 AND status<>'Cancelled' AND reversed_by_request_id IS NULL AND period_end>=$3",[db.clubId,bundle.targetId,d.period_end]))throw new RuleRefusal('Reverse or cancel later distributions first.');
    const rows=await entries(db,bundle);
    if(rows.length!==d.assessment_at_initiation.shares.perMember.filter(m=>m.finalCents>0).length || rows.reduce((n,e)=>n+toCents(e.amount),0)!==-toCents(d.total_distributed))throw new RuleRefusal('The complete distribution source evidence is missing.');
    if(await db.one(`SELECT p.payout_id FROM payout p JOIN member m ON m.club_id=p.club_id AND m.member_id=p.member_id WHERE p.club_id=$1 AND p.distribution_id=$2 AND (p.status<>'Approved' OR p.reversed_entry_id IS NOT NULL OR m.standing IN ('Exited','Expelled')) LIMIT 1`,[db.clubId,bundle.targetId]))throw new RuleRefusal('A recipient has left or a share changed. Resolve the later settlement first.');
    return;
  }
  const n=await db.one('SELECT * FROM exit_notice WHERE club_id=$1 AND notice_id=$2',[db.clubId,bundle.targetId]);
  const effect=await db.one('SELECT * FROM exit_effect WHERE club_id=$1 AND notice_id=$2',[db.clubId,bundle.targetId]);
  if(!n || n.status!=='Approved' || !effect)throw new RuleRefusal('This exit has no complete restoration evidence. Historical membership effects cannot be guessed.');
  if(n.writeoff_resolution_id)throw new RuleRefusal('This exit includes a member resolution forgiving debt. A new member resolution is required before that voted decision can be undone.');
  if(await db.one('SELECT notice_id FROM exit_reversal WHERE club_id=$1 AND notice_id=$2',[db.clubId,bundle.targetId]))throw new RuleRefusal('This exit was already reversed.');
  const m=await db.one('SELECT * FROM member WHERE club_id=$1 AND member_id=$2',[db.clubId,n.member_id]);
  if(m.standing!=='Exited' || m.role!==effect.member_before.role || toCents(m.credit_amount)!==0)throw new RuleRefusal('The membership changed after exit; it cannot be restored automatically.');
  if(JSON.stringify(await queueIds(db))!==JSON.stringify(effect.queue_after))throw new RuleRefusal('The payout queue changed after exit. Resolve later queue activity before restoring this membership.');
  if(await db.one(`SELECT entry_id FROM ledger_entry WHERE club_id=$1 AND member_id=$2 AND posted_at>$3 AND entry_id NOT IN($4::uuid,coalesce($5::uuid,$4::uuid)) LIMIT 1`,[db.clubId,n.member_id,n.decided_at,n.forfeiture_entry_id,n.repayment_entry_id]))throw new RuleRefusal('There is later account activity. Reverse it first.');
  const repo=require('../members/members.repo');
  const result=require('../../rules/officers').assessRoleCapacity({role:m.role,
    currentHolders:await repo.countHoldersOfRole(db,m.role),activeMemberCount:(await repo.countActiveMembers(db))+1});
  if(!result.eligible)throw new RuleRefusal(result.refusals[0]?.message || 'The restored officer role exceeds club capacity.');
  for(const a of effect.penalty_allocations) {
    const p=await db.one('SELECT settled_amount,waived_at FROM penalty WHERE club_id=$1 AND penalty_id=$2',[db.clubId,a.id]);
    if(!p || p.waived_at || toCents(p.settled_amount)!==toCents(a.after))throw new RuleRefusal('A penalty changed after exit. Resolve it before restoration.');
  }
}
async function create(db,e,why,actor) {
  const bundle=await identify(db,e); if(!bundle)return null;
  await check(db,bundle);
  const rows=await entries(db,bundle);
  rows.sort((a,b)=>a.entry_id===e.entry_id?-1:b.entry_id===e.entry_id?1:0);
  let root;
  for(const row of rows) {
    if(await requests.liveRequest(db,row.entry_id))throw new RuleRefusal('This settlement already has a reversal request.');
    const r=await requests.create(db,row.entry_id,why,actor.userId);root ||= r;
    await db.query('INSERT INTO reversal_bundle(club_id,root_request_id,request_id,scope,target_id) VALUES($1,$2,$3,$4,$5)',[db.clubId,root.request_id,r.request_id,bundle.scope,bundle.targetId]);
  }
  return {...root,scope:bundle.scope};
}
async function group(db,id) {
  const link=await db.one('SELECT * FROM reversal_bundle WHERE club_id=$1 AND request_id=$2',[db.clubId,id]);
  if(!link)return null;
  if(link.root_request_id!==id)throw new RuleRefusal('Use the complete settlement reversal request.');
  const rows=await db.many('SELECT r.* FROM ledger_reversal_request r JOIN reversal_bundle b ON b.club_id=r.club_id AND b.request_id=r.request_id WHERE b.club_id=$1 AND b.root_request_id=$2 ORDER BY r.request_id',[db.clubId,id]);
  return {scope:link.scope,targetId:link.target_id,rows};
}
async function finish(db,bundle,rootId) {
  if(bundle.scope==='Distribution') {
    await db.query('UPDATE distribution SET reversed_by_request_id=$3 WHERE club_id=$1 AND distribution_id=$2',[db.clubId,bundle.targetId,rootId]);return;
  }
  const effect=await db.one('SELECT * FROM exit_effect WHERE club_id=$1 AND notice_id=$2',[db.clubId,bundle.targetId]);
  const m=effect.member_before;
  await db.query('UPDATE member SET standing=$3,exit_date=$4,credit_amount=$5,updated_at=now() WHERE club_id=$1 AND member_id=$2',[db.clubId,m.member_id,m.standing,m.exit_date,m.credit_amount]);
  for(const a of effect.penalty_allocations) await db.query('UPDATE penalty SET settled_amount=$3 WHERE club_id=$1 AND penalty_id=$2',[db.clubId,a.id,a.before]);
  await queue.setPositions(db,effect.queue_before.map((memberId,i)=>({memberId,position:i+1})));
  await db.query('INSERT INTO exit_reversal(club_id,notice_id,request_id) VALUES($1,$2,$3)',[db.clubId,bundle.targetId,rootId]);
}
module.exports={identify,entries,check,create,group,finish,queueIds};
