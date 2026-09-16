"use strict";

/**
 * Environment configuration.
 *
 * Read once, validated once, at process start. A missing DATABASE_URL should
 * stop the server immediately with a readable message, not surface as a
 * connection error on the first request during a demonstration.
 */

require("dotenv").config();

function required(name) {
    const value = process.env[name];
    if (!value || !value.trim()) {
        console.error(
            `\n  Missing required environment variable: ${name}\n` +
            `  Copy server/.env.example to server/.env and fill it in.\n`
        );
        process.exit(1);
    }
    return value.trim();
}

function optional(name, fallback) {
    const value = process.env[name];
    return value === undefined || value === "" ? fallback : value;
}

function bool(name, fallback) {
    const value = process.env[name];
    if (value === undefined || value === "") return fallback;
    return ["1", "true", "yes", "on"].includes(String(value).toLowerCase());
}

function int(name, fallback) {
    const value = parseInt(process.env[name], 10);
    return Number.isFinite(value) ? value : fallback;
}

const NODE_ENV = optional("NODE_ENV", "development");

const env = {
    NODE_ENV,
    isProduction: NODE_ENV === "production",

    PORT: int("PORT", 4000),

    DATABASE_URL: required("DATABASE_URL"),
    // Supabase (and every other managed Postgres) requires TLS. A local
    // instance usually does not.
    DATABASE_SSL: bool("DATABASE_SSL", true),
    DB_POOL_MAX: int("DB_POOL_MAX", 10),

    // The Next.js origin, for CORS. Cookies are cross-origin here because the
    // API and the web app run on different ports, so the origin must be named
    // exactly — a wildcard is not permitted with credentials.
    WEB_ORIGIN: optional("WEB_ORIGIN", "http://localhost:3000"),

    // REQ-4: sessions expire after 30 minutes of inactivity.
    SESSION_IDLE_MINUTES: int("SESSION_IDLE_MINUTES", 30),
    SESSION_COOKIE_NAME: optional("SESSION_COOKIE_NAME", "sas_session"),

    // REQ-6: five consecutive failures, fifteen-minute lock.
    MAX_FAILED_ATTEMPTS: int("MAX_FAILED_ATTEMPTS", 5),
    LOCKOUT_MINUTES: int("LOCKOUT_MINUTES", 15),

    // Seed only. Never used outside src/db/seed.js.
    SEED_PASSWORD: optional("SEED_PASSWORD", "stokvel2026")
};

module.exports = { env };