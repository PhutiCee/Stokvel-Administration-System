"use strict";

/**
 * Authorisation. REQ-8, REQ-9.
 *
 *     router.post("/contributions",
 *         requireClubContext,
 *         authorize("contribution.capture"),
 *         handler);
 *
 * Every refusal is written to the audit log before the response goes out, which
 * is the second half of REQ-9. The message names the role the actor holds and
 * the role the operation needs, so the refusal is actionable rather than a
 * closed door.
 */

const { can, refusalReason } = require("../rules/permissions");
const { Forbidden, Unauthorised } = require("../lib/errors");

function authorize(action) {
    return async function authorizeMiddleware(req, res, next) {
        if (!req.actor) {
            return next(new Unauthorised("Your session has ended. Please sign in again."));
        }

        const role = req.actor.role;

        if (can(role, action)) return next();

        const reason = refusalReason(role, action);

        await req.audit("authz.refused", "Refused", {
            detail: `${req.actor.fullName} (${role || "no role"}) was refused "${action}" ` +
                    `on ${req.method} ${req.originalUrl}`,
            targetType: "operation",
            targetId: null
        });

        next(new Forbidden(reason, { action, role }));
    };
}

module.exports = { authorize };