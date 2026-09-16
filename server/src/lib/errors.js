"use strict";

/**
 * Typed errors.
 *
 * Services throw these; the error middleware turns them into responses. No
 * service ever touches `res` directly, which keeps the business logic testable
 * without an HTTP server.
 */

class AppError extends Error {
    constructor(status, code, message, detail) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        this.code = code;
        this.detail = detail;
        Error.captureStackTrace?.(this, this.constructor);
    }
}

/** 400 — the request itself is malformed or incomplete. */
class BadRequest extends AppError {
    constructor(message, detail) { super(400, "BAD_REQUEST", message, detail); }
}

/** 401 — not signed in, or the session has expired. */
class Unauthorised extends AppError {
    constructor(message = "You are not signed in.", detail) {
        super(401, "UNAUTHORISED", message, detail);
    }
}

/**
 * 403 — signed in, but the role does not permit this operation (REQ-8).
 * The refusal is recorded in the audit log by the authorize middleware.
 */
class Forbidden extends AppError {
    constructor(message = "This operation is not permitted for your role.", detail) {
        super(403, "FORBIDDEN", message, detail);
    }
}

/**
 * 404 — the record does not exist.
 *
 * REQ-14 requires that a record belonging to ANOTHER club be reported exactly
 * as if it did not exist, so cross-tenant access raises this, never Forbidden.
 * A 403 would confirm that the record is real, which is the disclosure the
 * requirement exists to prevent.
 */
class NotFound extends AppError {
    constructor(message = "Not found.", detail) {
        super(404, "NOT_FOUND", message, detail);
    }
}

/** 409 — the request is well-formed but conflicts with the current state. */
class Conflict extends AppError {
    constructor(message, detail) { super(409, "CONFLICT", message, detail); }
}

/**
 * 422 — the rules engine refused. The club's constitution does not permit what
 * was asked. Carries the checks that were evaluated so the interface can show
 * the member WHY, rather than a bare failure.
 */
class RuleRefusal extends AppError {
    constructor(message, detail) { super(422, "RULE_REFUSAL", message, detail); }
}

/** 429 — account locked after repeated failures (REQ-6). */
class TooManyAttempts extends AppError {
    constructor(message, detail) { super(429, "TOO_MANY_ATTEMPTS", message, detail); }
}

module.exports = {
    AppError, BadRequest, Unauthorised, Forbidden,
    NotFound, Conflict, RuleRefusal, TooManyAttempts
};