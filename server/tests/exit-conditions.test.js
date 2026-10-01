'use strict';
const {test}=require('node:test');
const assert=require('node:assert/strict');
const {validatePolicy,compute}=require('../src/rules/exit-settlement');
const totals={contributions:'100.01',paid_out:'0.00',club_contributions:'100.01',costs:'0.00',penalties:'0.00',outstanding:'0.00'};
const base={period:'membership',forfeitPercent:'25',deductPayouts:false,deductPenalties:false,deductCosts:false};
const clause={metric:'completedPaidCycles',threshold:12,evaluateAt:'notice',afterPercent:'0',definition:'Clause 8: one rotation means twelve fully paid completed cycles since joining.'};
test('conditional exit uses the lower branch before the exact threshold and the upper branch at it',()=>{
 const p=validatePolicy({...base,condition:clause});
 const before=compute(totals,p,{completedPaidCycles:11,evaluatedOn:'2026-10-01'});
 assert.equal(before.repayable,'75.01');assert.equal(before.percentageForfeit,'25.00');
 assert.equal(before.conditionResult.reached,false);
 const after=compute(totals,p,{completedPaidCycles:12,evaluatedOn:'2026-10-01'});
 assert.equal(after.repayable,'100.01');assert.equal(after.appliedForfeitPercent,'0.00');assert.equal(after.conditionResult.reached,true);
});
test('conditional exit never guesses an unsupported condition or missing evidence',()=>{
 for(const change of [{metric:'fullRotation'},{threshold:0},{threshold:1.5},{afterPercent:'101'},{evaluateAt:'automatic'},{definition:''}])assert.throws(()=>validatePolicy({...base,condition:{...clause,...change}}));
 assert.throws(()=>compute(totals,validatePolicy({...base,condition:clause})),/verified/);
 assert.throws(()=>validatePolicy({...base,conditions:[clause]}),/Unsupported/);
});
test('membership-day condition also records the exact boundary and remains separate from the calculation period',()=>{
 const p=validatePolicy({...base,condition:{...clause,metric:'membershipDays',threshold:365,afterPercent:'10',evaluateAt:'settlement'}});
 assert.equal(compute(totals,p,{membershipDays:365,evaluatedOn:'2026-10-01'}).repayable,'90.01');
 assert.equal(compute(totals,validatePolicy(base)).repayable,'75.01');
});
