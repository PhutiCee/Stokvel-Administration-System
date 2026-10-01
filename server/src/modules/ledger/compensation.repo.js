"use strict";
const { toCents, toNumeric } = require('../../lib/money');
const { RuleRefusal } = require('../../lib/errors');
const contributions = require('../contributions/contributions.repo');
const { resolveStatus } = require('../../rules/contributions');

async function recordReceipt(tx, entryId, contributionId, input, allocations) {
  await tx.query(`INSERT INTO capture_receipt(club_id,entry_id,contribution_id,receipt_date,method,reference,corrects_entry_id) VALUES($1,$2,$3,$4,$5,$6,$7)`,
    [tx.clubId,entryId,contributionId,input.receiptDate,input.method,input.reference || null,input.correctsEntryId || null]);
  for (const a of allocations) if(toCents(a.amount)>0)
    await tx.query(`INSERT INTO receipt_allocation(club_id,entry_id,kind,target_id,amount) VALUES($1,$2,$3,$4,$5)`,[tx.clubId,entryId,a.type,a.id,a.amount]);
}
async function applyCredits(tx, memberId, contributionId, totalCredit, applied) {
  const lots=await tx.many(`SELECT a.*, (a.amount-coalesce((SELECT sum(u.amount) FROM credit_application u WHERE u.club_id=a.club_id AND u.allocation_id=a.allocation_id),0))::text AS available
    FROM receipt_allocation a JOIN ledger_entry e ON e.club_id=a.club_id AND e.entry_id=a.entry_id
    WHERE a.club_id=$1 AND a.target_id=$2 AND a.kind='credit' AND NOT EXISTS(SELECT 1 FROM ledger_entry r WHERE r.club_id=a.club_id AND r.reverses_id=a.entry_id)
    ORDER BY e.posted_at,a.allocation_id`,[tx.clubId,memberId]);
  const tracked=lots.reduce((s,a)=>s+toCents(a.available),0);
  if(tracked>totalCredit)throw new RuleRefusal('Credit history does not match the member balance. Reconcile it before opening the cycle.');
  let remaining=Math.max(0,applied-(totalCredit-tracked)); // Use pre-migration credit first.
  for(const lot of lots){
    const amount=Math.min(remaining,toCents(lot.available));
    if(amount>0)await tx.query(`INSERT INTO credit_application(club_id,allocation_id,contribution_id,amount) VALUES($1,$2,$3,$4)`,[tx.clubId,lot.allocation_id,contributionId,toNumeric(amount)]);
    remaining-=amount;
  }
}
async function correction(tx, contributionId, entryId) {
  if(!entryId)return false;
  if(!/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(entryId))throw new RuleRefusal('Select the original reversed receipt to correct.');
  const row=await tx.one(`SELECT o.entry_id FROM ledger_entry o JOIN capture_receipt c ON c.club_id=o.club_id AND c.entry_id=o.entry_id
    JOIN ledger_entry r ON r.club_id=o.club_id AND r.reverses_id=o.entry_id
    WHERE o.club_id=$1 AND o.contribution_id=$2 AND o.entry_id=$3
    AND NOT EXISTS(SELECT 1 FROM capture_receipt used WHERE used.club_id=o.club_id AND used.corrects_entry_id=o.entry_id)`,[tx.clubId,contributionId,entryId]);
  if(!row)throw new RuleRefusal('A correction requires an unused reversed receipt for this contribution.');
  return true;
}
async function correctionCandidates(tx, contributionId) {
  return tx.many(`SELECT o.entry_id AS "entryId",o.amount::text AS amount FROM ledger_entry o JOIN capture_receipt c ON c.club_id=o.club_id AND c.entry_id=o.entry_id JOIN ledger_entry r ON r.club_id=o.club_id AND r.reverses_id=o.entry_id
    WHERE o.club_id=$1 AND o.contribution_id=$2 AND NOT EXISTS(SELECT 1 FROM capture_receipt used WHERE used.club_id=o.club_id AND used.corrects_entry_id=o.entry_id) ORDER BY r.posted_at`,[tx.clubId,contributionId]);
}
async function assertActive(tx, memberId) {
  const m=await tx.one('SELECT standing,credit_amount::text FROM member WHERE club_id=$1 AND member_id=$2',[tx.clubId,memberId]);
  if(!m || ['Exited','Expelled'].includes(m.standing))throw new RuleRefusal('This correction affects an ended membership. Resolve its settlement before correcting source transactions.');
  return m;
}
async function assertCycleUnpaid(tx, id) {
  const c=await contributions.getContribution(tx,id);
  if(!c || toCents(c.written_off_amount || '0')>0)throw new RuleRefusal('A written-off or missing obligation cannot be changed by a receipt reversal.');
  if(await tx.one(`SELECT payout_id FROM payout WHERE club_id=$1 AND cycle_id=$2 AND status<>'Cancelled' AND reversed_entry_id IS NULL LIMIT 1`,[tx.clubId,c.cycle_id]))
    throw new RuleRefusal('Reverse or cancel the payout for the affected cycle before correcting its contributions.');
  return c;
}
async function recalculate(tx,id) {
  const c=await contributions.getContribution(tx,id),k=await contributions.constitutionForCycle(tx,c.cycle_id);
  await contributions.setStatus(tx,id,resolveStatus({expected:c.expected_amount,captured:c.captured_amount,dueDate:c.due_date,graceDays:k?.grace_period_days || 0}));
}
async function reverseReceipt(tx,e) {
  if(!await tx.one('SELECT entry_id FROM capture_receipt WHERE club_id=$1 AND entry_id=$2',[tx.clubId,e.entry_id]))
    throw new RuleRefusal('This historical receipt has no allocation evidence. Reconcile its allocations before reversal; no balances have changed.');
  const member=await assertActive(tx,e.member_id);
  const allocations=await tx.many('SELECT * FROM receipt_allocation WHERE club_id=$1 AND entry_id=$2 ORDER BY allocation_id',[tx.clubId,e.entry_id]);
  const changed=new Set();
  for(const a of allocations){
    if(a.kind==='contribution'){
      const c=await assertCycleUnpaid(tx,a.target_id);
      if(toCents(c.captured_amount)<toCents(a.amount))throw new RuleRefusal('Captured allocation no longer matches the receipt.');
      await tx.query('UPDATE contribution SET captured_amount=captured_amount-$3,updated_at=now() WHERE club_id=$1 AND contribution_id=$2',[tx.clubId,a.target_id,a.amount]);
      changed.add(a.target_id);
    } else if(a.kind==='penalty') {
      const p=await tx.one('SELECT * FROM penalty WHERE club_id=$1 AND penalty_id=$2',[tx.clubId,a.target_id]);
      if(!p || toCents(p.settled_amount)<toCents(a.amount))throw new RuleRefusal('Penalty settlement no longer matches the receipt.');
      await tx.query('UPDATE penalty SET settled_amount=settled_amount-$3 WHERE club_id=$1 AND penalty_id=$2',[tx.clubId,a.target_id,a.amount]);
    } else {
      const uses=await tx.many('SELECT * FROM credit_application WHERE club_id=$1 AND allocation_id=$2',[tx.clubId,a.allocation_id]);
      let remaining=toCents(a.amount);
      for(const use of uses){
        await assertCycleUnpaid(tx,use.contribution_id);
        await tx.query('UPDATE contribution SET expected_amount=expected_amount+$3,updated_at=now() WHERE club_id=$1 AND contribution_id=$2',[tx.clubId,use.contribution_id,use.amount]);
        remaining-=toCents(use.amount);changed.add(use.contribution_id);
      }
      if(remaining>toCents(member.credit_amount))throw new RuleRefusal('Available credit no longer matches its receipt history.');
      await tx.query('UPDATE member SET credit_amount=credit_amount-$3,updated_at=now() WHERE club_id=$1 AND member_id=$2',[tx.clubId,e.member_id,toNumeric(remaining)]);
      member.credit_amount=toNumeric(toCents(member.credit_amount)-remaining);
    }
  }
  // Receipt metadata is projected from the latest surviving primary receipt.
  const last=await tx.one(`SELECT c.*,e.posted_at,e.posted_by FROM capture_receipt c JOIN ledger_entry e ON e.club_id=c.club_id AND e.entry_id=c.entry_id
    WHERE c.club_id=$1 AND c.contribution_id=$2 AND c.entry_id<>$3 AND NOT EXISTS(SELECT 1 FROM ledger_entry r WHERE r.club_id=e.club_id AND r.reverses_id=e.entry_id) ORDER BY e.posted_at DESC,e.entry_id DESC LIMIT 1`,[tx.clubId,e.contribution_id,e.entry_id]);
  await tx.query(`UPDATE contribution SET receipt_date=$3,method=$4,reference=$5,captured_at=$6,captured_by=$7 WHERE club_id=$1 AND contribution_id=$2`,[tx.clubId,e.contribution_id,last?.receipt_date || null,last?.method || null,last?.reference || null,last?.posted_at || null,last?.posted_by || null]);
  for(const id of changed)await recalculate(tx,id);
}
async function recordPayout(tx, entryId, payoutId, before=null, after=null){
  await tx.query('INSERT INTO payout_effect(club_id,entry_id,payout_id,queue_before,queue_after) VALUES($1,$2,$3,$4::jsonb,$5::jsonb)',[tx.clubId,entryId,payoutId,JSON.stringify(before),JSON.stringify(after)]);
}
async function reversePayout(tx,e,reversalId){
  if(!e.payout_id)throw new RuleRefusal('This historical payout has no source link. Its authorisation must be reconciled before reversal.');
  const p=await tx.one('SELECT * FROM payout WHERE club_id=$1 AND payout_id=$2',[tx.clubId,e.payout_id]);
  if(!p || p.status!=='Approved' || p.reversed_entry_id)throw new RuleRefusal('Only an approved, unreversed payout can be corrected.');
  if(p.payout_type==='Exit settlement')throw new RuleRefusal('An exit settlement includes membership and possibly voted debt write-offs. It cannot be reversed as an isolated payout.');
  if(p.payout_type==='Distribution')throw new RuleRefusal('Reverse a year-end distribution as a complete settlement, not an individual member share.');
  await assertActive(tx,p.member_id);
  if(p.payout_type==='Rotation'){
    const effect=await tx.one('SELECT * FROM payout_effect WHERE club_id=$1 AND entry_id=$2',[tx.clubId,e.entry_id]);
    const queue=require('../queue/queue.repo'),rows=await queue.listQueueRows(tx),ids=rows.map(r=>r.member_id);
    if(!effect?.queue_before || rows.some((r,i)=>r.queue_position!==i+1) || JSON.stringify(ids)!==JSON.stringify(effect.queue_after))throw new RuleRefusal('The queue changed after this payout. Reverse later payouts first; queue exchanges or membership changes require reconciliation.');
    if(await tx.one(`SELECT p.payout_id FROM payout p JOIN ledger_entry later ON later.club_id=p.club_id AND later.payout_id=p.payout_id AND later.reverses_id IS NULL WHERE p.club_id=$1 AND p.payout_type='Rotation' AND p.status='Approved' AND p.reversed_entry_id IS NULL AND p.payout_id<>$2 AND later.posted_at >= $3 LIMIT 1`,[tx.clubId,p.payout_id,e.posted_at]))throw new RuleRefusal('Reverse later rotation payouts before restoring this queue turn.');
    if(await tx.one(`SELECT payout_id FROM payout WHERE club_id=$1 AND payout_type='Rotation' AND status='Initiated' LIMIT 1`,[tx.clubId]))throw new RuleRefusal('Cancel the pending rotation payout before restoring this queue turn.');
    await queue.setPositions(tx,effect.queue_before.map((memberId,i)=>({memberId,position:i+1})));
  }
  await tx.query('UPDATE payout SET reversed_entry_id=$3 WHERE club_id=$1 AND payout_id=$2',[tx.clubId,p.payout_id,reversalId]);
  if(p.claim_id)await tx.query(`UPDATE burial_claim SET status='Lodged',initiated_by=NULL,initiated_at=NULL,approved_by=NULL,approved_at=NULL WHERE club_id=$1 AND claim_id=$2`,[tx.clubId,p.claim_id]);
}
module.exports={recordReceipt,applyCredits,correction,correctionCandidates,reverseReceipt,recordPayout,reversePayout};
