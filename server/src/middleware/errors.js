"use strict";

/**
 * Error handling.
 *
 * One shape for every error response, so the web app has one thing to parse:
 *
 *     { "error": { "code": "FORBIDDEN", "message": "...", "detail": { ... } } }
 *
 * Unexpected errors return a generic message. A PostgreSQL error string can
 * name tables, columns and constraints, and that is a map of the schema handed
 * to whoever triggered it. The real error goes to the server console where the
 * group can read it.
 */

const { AppError } = require("../lib/errors");
const { env } = require("../config/env");

function notFoundHandler(req, res) {
    res.status(404).json({
        error: { code: "NOT_FOUND", message: `No route for ${req.method} ${req.originalUrl}` }
    });
}

// Express identifies error middleware by arity: all four parameters must be
// declared even though `next` is unused.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, req, res, next) {
    if (err instanceof AppError) {
        return res.status(err.status).json({
            error: { code: err.code, message: err.message, detail: err.detail }
        });
    }

    // Violations of the append-only rules on ledger_entry and audit_log.
    if (err.code === "restrict_violation") {
        console.error("[append-only]", err.message);
        return res.status(409).json({
            error: {
                code: "APPEND_ONLY",
                message: "This record cannot be changed or removed. Post a " +
                         "reversing entry instead."
            }
        });
    }

    // Unique violation — a duplicate that got past the service check.
    if (err.code === "23505") {
        console.error("[db unique]", err.detail || err.message);
        return res.status(409).json({
            error: { code: "CONFLICT", message: "That record already exists." }
        });
    }

    // Foreign key violation.
    if (err.code === "23503") {
        console.error("[db fk]", err.detail || err.message);
        return res.status(409).json({
            error: {
                code: "CONFLICT",
                message: "That operation would leave a record referring to something " +
                         "that does not exist."
            }
        });
    }

    console.error(`[error] ${req.method} ${req.originalUrl}`);
    console.error(err);

    res.status(500).json({
        error: {
            code: "INTERNAL",
            message: "Something went wrong on our side. The attempt has been logged.",
            detail: env.isProduction ? undefined : { message: err.message }
        }
    });
}

/** Wraps an async handler so a rejected promise reaches the error middleware. */
const asyncRoute = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { notFoundHandler, errorHandler, asyncRoute };