"use strict";

/**
 * Entry point.
 *
 * Verifies the database is reachable BEFORE opening the port. A server that
 * accepts connections and then fails every request is worse than one that
 * refuses to start, particularly five minutes before a presentation.
 */

const { createApp } = require("./app");
const { env } = require("./config/env");
const { pool, healthcheck } = require("./db/pool");
const { sweepExpiredSessions } = require("./modules/auth/auth.repo");

async function start() {
    try {
        const db = await healthcheck();
        console.log(`  database   ${db.db} — connected`);
    } catch (err) {
        console.error("\n  Cannot reach the database.");
        console.error(`  ${err.message}\n`);
        console.error("  Check DATABASE_URL in server/.env.");
        console.error("  On Supabase use the Session pooler string (port 5432),");
        console.error("  not the direct connection, and keep DATABASE_SSL=true.\n");
        process.exit(1);
    }

    const app = createApp();

    const server = app.listen(env.PORT, () => {
        console.log(`  api        http://localhost:${env.PORT}`);
        console.log(`  web origin ${env.WEB_ORIGIN}`);
        console.log(`  mode       ${env.NODE_ENV}\n`);
    });

    // REQ-4 housekeeping. Expired sessions are already refused at resolution
    // time; this keeps the table tidy so that "who was signed in, and when"
    // remains answerable from the data.
    const sweeper = setInterval(() => {
        sweepExpiredSessions().catch((e) => console.error("[sweep]", e.message));
    }, 5 * 60_000);
    sweeper.unref();

    async function shutdown(signal) {
        console.log(`\n  ${signal} received, shutting down.`);
        clearInterval(sweeper);
        server.close(async () => {
            await pool.end();
            process.exit(0);
        });
        // Do not hang for ever on a stuck connection.
        setTimeout(() => process.exit(1), 10_000).unref();
    }

    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
}

start();