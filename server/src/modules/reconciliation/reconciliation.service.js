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
    const differenceCents = bankCents - ledgerCents;

    if(differenceCents!==0 && (typeof note!=='string' || !note.trim()))throw new BadRequest('Explain the reconciliation difference; it cannot be cleared silently.');
    const created = await repo.insertReconciliation(tx, {
        asAtDate: date,
        bankBalance: toNumeric(bankCents),
        ledgerBalance: toNumeric(ledgerCents),
        difference: toNumeric(differenceCents),
        note: note && String(note).trim() ? String(note).trim() : null,
        recordedBy: actor.userId
    });

    return {created,ledgerCents,differenceCents};
    });
    const {created,ledgerCents,differenceCents}=result;
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
        latest: history[0] ? { ...history[0], status: statusOf(toCents(history[0].difference)) } : null,
        reconciliations: history.map((r) => ({ ...r, status: statusOf(toCents(r.difference)) }))
    };
}

module.exports = { reconcile, listReconciliations };
