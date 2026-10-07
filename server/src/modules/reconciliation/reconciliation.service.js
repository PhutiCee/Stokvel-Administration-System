"use strict";

/**
 * Reconciliation. SDD 4.1, Ledger Service reconcile().
 *
 *     reconcile()          compare the ledger pool balance with the bank balance
 *                          the Treasurer typed in, record the result, flag any gap
 *     listReconciliations() past checks, newest first, with the live ledger balance
 *
 * The system records money but never holds or moves it (SRS 1.1), so the bank
 * balance is always entered by hand and never pulled from a bank. The ledger
 * side is summed from the book at the moment of the check, the same way
 * getPoolBalance() does it, so the two figures cannot drift apart.
 *
 * difference = bank - ledger. Zero means the books agree; positive means the
 * bank holds more than the ledger explains; negative means the ledger claims
 * money the bank does not have.
 *
 * No Express in this file.
 */

const repo = require("./reconciliation.repo");
const { toCents, toNumeric, format } = require("../../lib/money");
const { BadRequest } = require("../../lib/errors");

const { todayIso, isIsoDate } = require("../../lib/dates");
const { withClubTransaction } = require("../../db/tx");

const statusOf = (differenceCents) => (differenceCents === 0 ? "Balanced" : "Gap");

async function reconcile(db, { bankBalance, asAtDate, note }, { actor, audit }) {
    if (bankBalance === undefined || bankBalance === null || bankBalance === "") {
        throw new BadRequest("Enter the balance shown by the bank.");
    }

    let bankCents;
    try {
        bankCents = toCents(bankBalance);
    } catch {
        throw new BadRequest("The bank balance must be an amount, for example 12500.00.");
    }
    if (bankCents < 0) throw new BadRequest("The bank balance cannot be negative.");

    const today = todayIso();
    const date = asAtDate ? String(asAtDate).trim() : today;
    if (!isIsoDate(date)) {
        throw new BadRequest("Give the date as YYYY-MM-DD.");
    }
    if (date > today) throw new BadRequest("The reconciliation date cannot be in the future.");

    const result = await withClubTransaction(db.clubId,async tx=>{
    await tx.one('SELECT club_id FROM club WHERE club_id=$1 FOR UPDATE',[tx.clubId]);
    const ledgerCents = toCents(await repo.ledgerBalance(tx,date));
    const contributionsCaptured = await repo.contributionTotal(tx,date);
    const differenceCents = bankCents - ledgerCents;

    if(differenceCents!==0 && (typeof note!=='string' || !note.trim()))throw new BadRequest('Explain the reconciliation difference; it cannot be cleared silently.');
    const created = await repo.insertReconciliation(tx, {
        asAtDate: date,
        bankBalance: toNumeric(bankCents),
        ledgerBalance: toNumeric(ledgerCents),
        difference: toNumeric(differenceCents),
        note: note && String(note).trim() ? String(note).trim() : null,
        contributionsCaptured,
        recordedBy: actor.userId
    });

    return {created,ledgerCents,differenceCents,contributionsCaptured};
    });
    const {created,ledgerCents,differenceCents,contributionsCaptured}=result;
    const status = statusOf(differenceCents);
    await audit("reconciliation.record", "Success", {
        detail: status === "Balanced"
            ? `${actor.fullName} reconciled the pool to the bank at ${format(bankCents)}: balanced`
            : `${actor.fullName} reconciled the pool: bank ${format(bankCents)}, ledger ${format(ledgerCents)}, gap ${format(differenceCents)}`,
        targetType: "reconciliation",
        targetId: created.reconciliation_id
    });

    return {
        reconciliationId: created.reconciliation_id,
        contributionsCaptured,
        asAtDate: date,
        bankBalance: toNumeric(bankCents),
        ledgerBalance: toNumeric(ledgerCents),
        difference: toNumeric(differenceCents),
        status,
        note: note && String(note).trim() ? String(note).trim() : null,
        recordedBy: actor.fullName
    };
}

async function listReconciliations(db) {
    const [history, ledger] = await Promise.all([repo.listForClub(db), repo.ledgerBalance(db)]);
    return {
        ledgerBalance: ledger,
        contributionsCaptured: await repo.contributionTotal(db),
        latest: history[0] ? { ...history[0], status: history[0].resolution ? "Resolved" : statusOf(toCents(history[0].difference)) } : null,
        reconciliations: history.map((r) => ({ ...r, status: r.resolution ? "Resolved" : statusOf(toCents(r.difference)) }))
    };
}

module.exports = { reconcile, listReconciliations };

module.exports.resolve = async (db,id,input,{actor,audit}) => {
  const {BadRequest,NotFound,RuleRefusal}=require('../../lib/errors');
  if(!Array.isArray(input.entryIds) || !input.entryIds.length || input.entryIds.length>30 || new Set(input.entryIds).size!==input.entryIds.length || input.entryIds.some(x=>typeof x!=='string' || !/^[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(x)))throw new BadRequest('Choose distinct explanatory ledger entries.');
  if(typeof input.explanation!=='string' || input.explanation.trim().length<3 || input.explanation.length>2000)throw new BadRequest('Explain how these entries resolve the recorded difference.');
  await withClubTransaction(db.clubId,async tx=>{
    await tx.one('SELECT club_id FROM club WHERE club_id=$1 FOR UPDATE',[db.clubId]);
    const r=await tx.one('SELECT * FROM reconciliation WHERE club_id=$1 AND reconciliation_id=$2',[db.clubId,id]);
    if(!r)throw new NotFound('Reconciliation not found in this club.');
    if(toCents(r.difference)===0 || await tx.one('SELECT reconciliation_id FROM reconciliation_resolution WHERE club_id=$1 AND reconciliation_id=$2',[db.clubId,id]))throw new RuleRefusal('This reconciliation has no unresolved gap.');
    const entries=await tx.many(`SELECT e.entry_id,e.cash_amount FROM cash_ledger_entry e WHERE e.club_id=$1 AND e.entry_id=ANY($2::uuid[]) AND e.posted_at>= $3
      AND NOT EXISTS(SELECT 1 FROM ledger_entry rev WHERE rev.club_id=e.club_id AND rev.reverses_id=e.entry_id)
      AND NOT EXISTS(SELECT 1 FROM reconciliation_resolution_entry used WHERE used.club_id=e.club_id AND used.entry_id=e.entry_id)`,[db.clubId,input.entryIds,r.recorded_at]);
    if(entries.length!==input.entryIds.length || entries.some(e=>toCents(e.cash_amount)===0) || entries.reduce((n,e)=>n+toCents(e.cash_amount),0)!==toCents(r.difference))throw new RuleRefusal('The unused, unreversed entries posted since this check must exactly explain its difference.');
    await tx.query('INSERT INTO reconciliation_resolution(club_id,reconciliation_id,explanation,resolved_by) VALUES($1,$2,$3,$4)',[db.clubId,id,input.explanation.trim(),actor.userId]);
    for(const e of entries) await tx.query('INSERT INTO reconciliation_resolution_entry(club_id,reconciliation_id,entry_id) VALUES($1,$2,$3)',[db.clubId,id,e.entry_id]);
  });
  await audit('reconciliation.resolve','Success',{targetType:'reconciliation',targetId:id,detail:input.explanation.trim()});
  return {reconciliationId:id,status:'Resolved'};
};
