"use strict";

/**
 * Migration runner.
 *
 *     npm run migrate           apply everything outstanding
 *     npm run migrate:status    show what has and has not been applied
 *     npm run migrate:reset     drop the public schema and reapply  (DESTRUCTIVE)
 *
 * Files in ./migrations run in filename order and each runs inside a
 * transaction, so a migration that fails half way leaves nothing behind.
 * Applied filenames are recorded in schema_migrations; a file already recorded
 * is skipped, so running this twice is safe.
 *
 * Do not edit a migration that has already been applied on anybody else's
 * machine. Add a new one.
 */

const fs = require("fs");
const path = require("path");
const { pool } = require("./pool");

const DIR = path.join(__dirname, "migrations");

async function ensureRegistry() {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename   TEXT PRIMARY KEY,
            applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
    `);
}

function migrationFiles() {
    return fs.readdirSync(DIR).filter((f) => f.endsWith(".sql")).sort();
}

async function appliedSet() {
    const { rows } = await pool.query("SELECT filename FROM schema_migrations");
    return new Set(rows.map((r) => r.filename));
}

async function up() {
    await ensureRegistry();
    const applied = await appliedSet();
    const pending = migrationFiles().filter((f) => !applied.has(f));

    if (pending.length === 0) {
        console.log("  Nothing to apply. Schema is current.");
        return;
    }

    for (const filename of pending) {
        const sql = fs.readFileSync(path.join(DIR, filename), "utf8");
        const client = await pool.connect();
        try {
            await client.query("BEGIN");
            await client.query(sql);
            await client.query(
                "INSERT INTO schema_migrations (filename) VALUES ($1)", [filename]
            );
            await client.query("COMMIT");
            console.log(`  applied   ${filename}`);
        } catch (err) {
            await client.query("ROLLBACK");
            console.error(`\n  FAILED    ${filename}`);
            console.error(`  ${err.message}\n`);
            throw err;
        } finally {
            client.release();
        }
    }
    console.log(`\n  ${pending.length} migration(s) applied.`);
}

async function status() {
    await ensureRegistry();
    const applied = await appliedSet();
    for (const f of migrationFiles()) {
        console.log(`  ${applied.has(f) ? "applied  " : "PENDING  "} ${f}`);
    }
}

/** DESTRUCTIVE. Everything in the database is deleted. */
async function reset() {
    if (process.env.NODE_ENV === "production") {
        console.error("  Refusing to reset in production.");
        process.exit(1);
    }
    console.log("  Dropping schema public ...");
    await pool.query("DROP SCHEMA public CASCADE");
    await pool.query("CREATE SCHEMA public");
    console.log("  Reapplying migrations ...\n");
    await up();
}

async function main() {
    const command = process.argv[2] || "up";
    try {
        if (command === "up") await up();
        else if (command === "status") await status();
        else if (command === "reset") await reset();
        else {
            console.error(`  Unknown command "${command}". Use up, status or reset.`);
            process.exit(1);
        }
    } catch (err) {
        console.error(`\n  Migration failed: ${err.message}`);
        if (err.code) console.error(`  PostgreSQL code: ${err.code}`);
        process.exit(1);
    } finally {
        await pool.end();
    }
}

main();