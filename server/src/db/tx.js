"use strict";

/**
 * Transaction helper.
 *
 * SDD 5.2.2: "Every financially significant operation runs in a single
 * transaction, so a contribution and its ledger entry either both persist or
 * neither does."
 *
 * Usage:
 *
 *   const result = await withTransaction(async (client) => {
 *       const db = forClub(clubId, client);        // tenancy guard still applies
 *       await db.query("UPDATE contribution SET ... WHERE club_id = $1", [clubId]);
 *       await db.query("INSERT INTO ledger_entry ...", [...]);
 *       return something;
 *   });
 *
 * Throwing anywhere inside the callback rolls the whole thing back.
 */

const { pool, forClub } = require("./pool");

async function withTransaction(callback) {
    const client = await pool.connect();
    try {
        await client.query("BEGIN");
        const result = await callback(client);
        await client.query("COMMIT");
        return result;
    } catch (err) {
        try {
            await client.query("ROLLBACK");
        } catch (rollbackErr) {
            console.error("[db] rollback failed:", rollbackErr.message);
        }
        throw err;
    } finally {
        client.release();
    }
}

/**
 * The common case: a transaction that is already scoped to one club.
 *
 *   await withClubTransaction(clubId, async (db, client) => { ... });
 */
async function withClubTransaction(clubId, callback) {
    return withTransaction((client) => callback(forClub(clubId, client), client));
}

module.exports = { withTransaction, withClubTransaction };