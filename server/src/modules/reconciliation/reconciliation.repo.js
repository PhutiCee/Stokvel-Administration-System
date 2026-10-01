"use strict";

/**
 * Reconciliation repo. SQL only, no rules.
 */

function presentReconciliation(r) {
    return {
        reconciliationId: r.reconciliation_id,
        asAtDate: r.as_at_date,
        bankBalance: r.bank_balance,
        ledgerBalance: r.ledger_balance,
        difference: r.difference,
        note: r.note,
        recordedBy: r.recorded_by_name,
        recordedAt: r.recorded_at
    };
}

async function ledgerBalance(db,date=null) {
    const row = await db.one(
        "SELECT COALESCE(sum(amount), 0) AS balance FROM ledger_entry WHERE club_id = $1 AND ($2::date IS NULL OR posted_at < (($2::date + 1)::timestamp AT TIME ZONE 'Africa/Johannesburg'))",
        [db.clubId,date]
    );
    return row.balance;
}

async function insertReconciliation(db, { asAtDate, bankBalance, ledgerBalance, difference, note, recordedBy }) {
    return db.one(
        `INSERT INTO reconciliation
                (club_id, as_at_date, bank_balance, ledger_balance, difference, note, recorded_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING reconciliation_id`,
        [db.clubId, asAtDate, bankBalance, ledgerBalance, difference, note, recordedBy]
    );
}

async function listForClub(db, { limit = 50 } = {}) {
    const rows = await db.many(
        `SELECT r.reconciliation_id, r.as_at_date::text AS as_at_date, r.bank_balance,
                r.ledger_balance, r.difference, r.note, r.recorded_at::text AS recorded_at,
                u.full_name AS recorded_by_name
           FROM reconciliation r
           JOIN user_account u ON u.user_id = r.recorded_by
          WHERE r.club_id = $1
          ORDER BY r.as_at_date DESC, r.recorded_at DESC
          LIMIT $2`,
        [db.clubId, limit]
    );
    return rows.map(presentReconciliation);
}

module.exports = { ledgerBalance, insertReconciliation, listForClub };
