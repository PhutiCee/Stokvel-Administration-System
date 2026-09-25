"use strict";

/**
 * PostgreSQL connection pool.
 *
 * One pool for the whole process (SDD 4.2: "a pooled connection from the
 * application tier"). Do not create a Client anywhere else.
 */

const dns = require("dns");
const { Pool, types } = require("pg");

// Node 17+ returns DNS results in resolver order and will often attempt IPv6
// first. Supabase's pooler publishes IPv6 records that are unroutable on many
// South African networks and on most VPNs, so the connection hangs until the
// timeout expires rather than failing fast. Force IPv4.
dns.setDefaultResultOrder("ipv4first");
const { env } = require("../config/env");

// ---------------------------------------------------------------------------
// Type parsing
// ---------------------------------------------------------------------------
// By default node-postgres hands NUMERIC back as a JavaScript string. Leave it
// that way. Converting money to a double here would reintroduce exactly the
// floating-point error that NUMERIC(12,2) was chosen to avoid (SDD 5.2.1).
// All arithmetic goes through lib/money.js, which works in integer cents.
//
// OID 1700 = NUMERIC. Listed explicitly so that nobody "helpfully" adds a
// parser later without reading this comment.
types.setTypeParser(1700, (value) => value);

const pool = new Pool({
    connectionString: env.DATABASE_URL,
    ssl: env.DATABASE_SSL ? { rejectUnauthorized: false } : false,
    max: env.DB_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 30_000,
    application_name: "stokvel-admin-system"
});

pool.on("error", (err) => {
    // An idle client in the pool errored. Log it; the pool replaces the client.
    console.error("[db] idle client error:", err.message);
});

// ---------------------------------------------------------------------------
// Tenancy guard
// ---------------------------------------------------------------------------
// REQ-13 requires that no data-retrieval operation can return a record
// belonging to another club. Middleware that merely *makes the club id
// available* does not achieve that — a developer can still forget the
// predicate, and the bug is silent.
//
// So: every tenant-scoped table is listed below, and forClub() refuses to run
// any statement that touches one of them without a club_id predicate. The
// failure is loud, immediate, and happens the first time the query runs rather
// than in front of the assessor.
//
// This is the implementation of the "tenancy filter wrapping all data access"
// described in SDD 4.1.

const TENANT_SCOPED_TABLES = [
    "club",
    "constitution",
    "member",
    "beneficiary",
    "dependant",
    "cycle",
    "contribution",
    "penalty",
    "ledger_entry",
    "reconciliation",
    "payout",
    "queue_swap",
    "queue_arrears_decision",
    "distribution",
    "burial_claim"
];

const TABLE_PATTERN = new RegExp(
    `\\b(?:from|join|into|update)\\s+(?:only\\s+)?"?(${TENANT_SCOPED_TABLES.join("|")})"?\\b`,
    "i"
);
const CLUB_PREDICATE_PATTERN = /\bclub_id\b/i;

function assertScoped(sql) {
    const touchesTenantTable = TABLE_PATTERN.test(sql);
    if (!touchesTenantTable) return;
    if (CLUB_PREDICATE_PATTERN.test(sql)) return;

    throw new Error(
        "Tenancy violation (REQ-13): this statement reads or writes a " +
        "club-scoped table without a club_id predicate.\n\n" +
        sql.trim().split("\n").map((l) => "    " + l).join("\n") +
        "\n\nAdd club_id to the WHERE clause, or use pool.query() directly if " +
        "this is genuinely a platform-level statement (migrations, the club " +
        "list on the sign-in path, and the audit log are the only legitimate " +
        "cases)."
    );
}

/**
 * Returns a query interface locked to one club.
 *
 * The clubId is supplied by the tenancy middleware from the SERVER-SIDE
 * SESSION. It never comes from a request body, a query string or a header, so
 * a client cannot assert its way into another club's data.
 *
 *   const db = pool.forClub(req.actor.clubId);
 *   const { rows } = await db.query(
 *     "SELECT * FROM member WHERE club_id = $1 AND member_id = $2",
 *     [db.clubId, memberId]
 *   );
 */
function forClub(clubId, executor = pool) {
    if (!clubId) throw new Error("forClub() called without a club id.");
    return {
        clubId,
        async query(sql, params = []) {
            assertScoped(sql);
            return executor.query(sql, params);
        },
        /** Convenience: first row, or null. */
        async one(sql, params = []) {
            assertScoped(sql);
            const { rows } = await executor.query(sql, params);
            return rows[0] || null;
        },
        /** Convenience: rows array. */
        async many(sql, params = []) {
            assertScoped(sql);
            const { rows } = await executor.query(sql, params);
            return rows;
        }
    };
}

pool.forClub = forClub;

async function healthcheck() {
    const { rows } = await pool.query("SELECT now() AS at, current_database() AS db");
    return rows[0];
}

module.exports = { pool, forClub, healthcheck, TENANT_SCOPED_TABLES };