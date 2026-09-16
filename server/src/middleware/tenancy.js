"use strict";

/**
 * Tenancy filter. REQ-12, REQ-13, REQ-14, BR-10.
 *
 * SDD 4.1 describes this as middleware that wraps all data access. It does two
 * things.
 *
 * 1. requireClubContext — refuses any club-level request made without an active
 *    club, and attaches req.db, a query interface locked to that club. Route
 *    handlers get their database access from req.db and have no way to reach
 *    another tenant's rows: src/db/pool.js throws if a statement touches a
 *    club-scoped table without a club_id predicate.
 *
 * 2. assertOwned — the check for identifiers arriving in a URL or body. A
 *    treasurer of Club A who pastes a member id belonging to Club B must be
 *    told the record does not exist (REQ-14), NOT that it exists but is
 *    forbidden. A 403 confirms the record is real, and that confirmation is
 *    itself the leak. The attempt is audited.
 */

const { forClub } = require("../db/pool");
const { Unauthorised, Forbidden, NotFound } = require("../lib/errors");

/**
 * Requires an authenticated user with a club selected.
 */
function requireClubContext(req, res, next) {
    if (!req.actor) {
        return next(new Unauthorised("Your session has ended. Please sign in again."));
    }

    // BR-10. The platform administrator does not get a club context, ever, even
    // if a club id somehow reaches the session row.
    if (req.actor.isPlatformAdmin) {
        req.audit("tenancy.platformAdminBlocked", "Refused", {
            detail: `Platform administrator attempted club-level route ${req.method} ${req.originalUrl}`
        });
        return next(new Forbidden(
            "The Platform Administrator has no access to club-level records (BR-10)."
        ));
    }

    if (!req.actor.clubId) {
        return next(new Unauthorised("No club is selected. Choose a club first."));
    }

    if (!req.actor.role) {
        return next(new Forbidden("You are not a member of this club."));
    }

    if (req.actor.clubStatus === "Suspended") {
        return next(new Forbidden(
            "This club is suspended. Records are readable by the Platform " +
            "Administrator only until it is reinstated."
        ));
    }

    req.db = forClub(req.actor.clubId);
    req.clubId = req.actor.clubId;
    next();
}

/**
 * Confirms a row belongs to the active club before it is used.
 *
 *     const member = await assertOwned(req, "member", "member_id", req.params.id);
 *
 * Returns the row. Throws NotFound if it is missing OR belongs elsewhere —
 * deliberately the same outcome, which is the whole point of REQ-14.
 */
async function assertOwned(req, table, idColumn, id, label = "record") {
    if (!id) throw new NotFound(`No ${label} was specified.`);

    // Deliberately NOT parameterised on the identifier column or table name —
    // those come from our own call sites, never from user input. The value does
    // go through a bound parameter.
    const { rows } = await req.db.query(
        `SELECT * FROM ${table} WHERE ${idColumn} = $1 AND club_id = $2`,
        [id, req.clubId]
    );

    if (rows[0]) return rows[0];

    // Did it exist, but in another club? Record the probe, then lie by omission
    // exactly as the requirement demands.
    const { pool } = require("../db/pool");
    const elsewhere = await pool.query(
        `SELECT club_id FROM ${table} WHERE ${idColumn} = $1`,
        [id]
    );
    if (elsewhere.rows[0]) {
        await req.audit("tenancy.crossTenantAttempt", "Refused", {
            detail: `${req.actor.fullName} in club ${req.clubId} requested ${table}.${id}, ` +
                    `which belongs to club ${elsewhere.rows[0].club_id}. ` +
                    `Answered as not found (REQ-14).`,
            targetType: table,
            targetId: id
        });
    }

    throw new NotFound(`That ${label} was not found in this club.`);
}

/** Platform-level routes only. The mirror image of requireClubContext. */
function requirePlatformAdmin(req, res, next) {
    if (!req.actor) {
        return next(new Unauthorised("Your session has ended. Please sign in again."));
    }
    if (!req.actor.isPlatformAdmin) {
        req.audit("platform.accessRefused", "Refused", {
            detail: `${req.actor.fullName} attempted ${req.method} ${req.originalUrl}`
        });
        return next(new Forbidden("This area is restricted to the Platform Administrator."));
    }
    next();
}

module.exports = { requireClubContext, requirePlatformAdmin, assertOwned };