"use strict";

/**
 * Audit log. REQ-9, REQ-14, REQ-99.
 *
 * This is AuditLogEntry.record() from SRS 4.4.19.
 *
 * Attaches req.audit(...) to every request, already carrying the actor, club,
 * source address and user agent, so that a call site only has to say what
 * happened:
 *
 *     await req.audit("contribution.capture", "Success", {
 *         detail: "R500.00 captured for Lerato Ndlovu",
 *         targetType: "contribution",
 *         targetId: contributionId
 *     });
 *
 * A failure to write the audit log is logged to the console and swallowed. The
 * audit trail must never be the reason a member cannot pay their contribution.
 */

const { pool } = require("../db/pool");

function clientIp(req) {
    const forwarded = req.headers["x-forwarded-for"];
    const raw = (typeof forwarded === "string" ? forwarded.split(",")[0] : null)
        || req.socket?.remoteAddress
        || null;
    if (!raw) return null;
    // ::ffff:127.0.0.1 -> 127.0.0.1, so the INET column accepts it.
    return raw.replace(/^::ffff:/, "");
}

/**
 * Writes one row. Exported separately so that code outside a request (the
 * session sweeper, the seed script) can record too.
 */
async function record({
    clubId = null, userId = null, action, outcome = "Success",
    detail = null, targetType = null, targetId = null,
    ipAddress = null, userAgent = null
}) {
    try {
        await pool.query(
            `INSERT INTO audit_log
                 (club_id, user_id, action, outcome, detail,
                  target_type, target_id, ip_address, user_agent)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
            [clubId, userId, action, outcome, detail,
             targetType, targetId, ipAddress, userAgent]
        );
    } catch (err) {
        console.error(`[audit] failed to record ${action}:`, err.message);
    }
}

function attachAudit(req, res, next) {
    const ipAddress = clientIp(req);
    const userAgent = req.headers["user-agent"] || null;

    req.audit = (action, outcome = "Success", extra = {}) => record({
        // req.actor is set later by authenticate(); reading it at call time
        // rather than here means a login can audit itself after it succeeds.
        clubId: extra.clubId !== undefined ? extra.clubId : (req.actor?.clubId ?? null),
        userId: extra.userId !== undefined ? extra.userId : (req.actor?.userId ?? null),
        action,
        outcome,
        detail: extra.detail ?? null,
        targetType: extra.targetType ?? null,
        targetId: extra.targetId ?? null,
        ipAddress,
        userAgent
    });

    req.clientIp = ipAddress;
    next();
}

module.exports = { attachAudit, record, clientIp };