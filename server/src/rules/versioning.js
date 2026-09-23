"use strict";

/**
 * Constitution versioning. REQ-30, REQ-31, REQ-33.
 *
 *     versionInForce()      which version governs a given date        REQ-31
 *     diffVersions()        what an amendment changes                 REQ-30
 *     validateNewVersion()  may this amendment be recorded            REQ-29, REQ-30, REQ-33
 *
 * This file is the single place that decides which constitution version applies
 * on a date. The penalty rule, the payout rules and the burial waiting period
 * all ask this function and never work the answer out for themselves, because
 * two slightly different answers to "which rules were in force" is how a
 * payout ends up assessed against the wrong constitution.
 *
 * Versions arrive as plain objects with a numeric version and an effectiveDate
 * written YYYY-MM-DD (see lib/dates.js for why dates are never Date objects).
 *
 * Pure functions. No database, no Express.
 */

const { assertIsoDate, isIsoDate, compareIso } = require("../lib/dates");
const { toCents } = require("../lib/money");
const { validateConsistency } = require("./constitution");

/**
 * The parameters an amendment may change. The club type and the date the
 * cycles are anchored to are fixed for the life of the club, so they are not
 * in this list: a Rotating club cannot amend itself into a Burial society.
 */
const AMENDABLE_FIELDS = [
    "contributionAmount",
    "cycleFrequency",
    "penaltyAmount",
    "gracePeriodDays",
    "quorumPercentage",
    "exitNoticeDays",
    "payoutOrderMethod",
    "forfeitureRule",
    "waitingPeriodDays",
    "benefitSchedule",
    "yearEndMonth",
    "yearEndDay"
];

const MONEY_FIELDS = ["contributionAmount", "penaltyAmount"];

// ---------------------------------------------------------------------------
// versionInForce()  REQ-31
// ---------------------------------------------------------------------------

/**
 * The version in force on a date: the one with the latest effective date that
 * is not after the date asked about. If two versions share an effective date,
 * the higher version number wins, because it was recorded later.
 *
 * Returns null when the date is earlier than every version. That is a real
 * answer for a burial claim dated before the club was constituted, and the
 * caller decides how to refuse it.
 *
 * A version that takes effect ON the date is in force on that date.
 *
 * @param {Array<{version:number, effectiveDate:string}>} versions any order
 * @param {string} onDate YYYY-MM-DD
 */
function versionInForce(versions, onDate) {
    assertIsoDate(onDate, "The date to resolve");

    let best = null;
    for (const v of versions) {
        assertIsoDate(v.effectiveDate, `Effective date of version ${v.version}`);
        if (compareIso(v.effectiveDate, onDate) > 0) continue;

        if (
            best === null ||
            compareIso(v.effectiveDate, best.effectiveDate) > 0 ||
            (v.effectiveDate === best.effectiveDate && v.version > best.version)
        ) {
            best = v;
        }
    }
    return best;
}

// ---------------------------------------------------------------------------
// diffVersions()
// ---------------------------------------------------------------------------

function canonicalMoney(value) {
    try {
        return String(toCents(value ?? 0));
    } catch {
        return `invalid:${String(value)}`;
    }
}

function canonicalSchedule(schedule) {
    const rows = Array.isArray(schedule) ? schedule : [];
    return JSON.stringify(
        rows
            .map((r) => ({
                category: String(r?.category ?? "").trim().toLowerCase(),
                cents: canonicalMoney(r?.amount)
            }))
            .sort((a, b) => a.category.localeCompare(b.category))
    );
}

function canonical(field, value) {
    if (MONEY_FIELDS.includes(field)) return canonicalMoney(value);
    if (field === "benefitSchedule") return canonicalSchedule(value);
    if (value === undefined || value === null || value === "") return "";
    return String(value).trim();
}

/**
 * The fields that differ between two parameter sets. Money is compared in
 * cents, so "500" and "500.00" are the same contribution, and the benefit
 * schedule is compared without regard to row order.
 *
 * @returns {Array<{field:string, from:*, to:*}>}
 */
function diffVersions(before, after) {
    const changes = [];
    for (const field of AMENDABLE_FIELDS) {
        if (canonical(field, before[field]) !== canonical(field, after[field])) {
            changes.push({ field, from: before[field] ?? null, to: after[field] ?? null });
        }
    }
    return changes;
}

// ---------------------------------------------------------------------------
// validateNewVersion()  REQ-29, REQ-30, REQ-33
// ---------------------------------------------------------------------------

/**
 * Drops the parameters that do not apply to this club type, the same way
 * createClub does when it writes version 1. A Rotating club has no benefit
 * schedule and no waiting period, and a Burial society has no payout order.
 */
function normaliseForClubType(clubType, params) {
    return {
        ...params,
        payoutOrderMethod: clubType === "Rotating" ? params.payoutOrderMethod ?? null : null,
        waitingPeriodDays: clubType === "Burial" ? Number(params.waitingPeriodDays ?? 0) : 0,
        benefitSchedule: clubType === "Burial" ? params.benefitSchedule ?? [] : [],
        yearEndMonth: clubType === "Accumulating" ? Number(params.yearEndMonth) || null : null,
        yearEndDay: clubType === "Accumulating" ? Number(params.yearEndDay) || null : null
    };
}

/**
 * Decides whether an amendment may be recorded as the next version.
 *
 * The amendment is a set of changes laid over the version currently in force.
 * The caller does not have to restate every parameter, and cannot silently
 * alter one it did not mention.
 *
 * The date rules protect history:
 *
 *  - The effective date may not be in the past (REQ-33). An amendment applies
 *    prospectively. A retroactive one would change the answer to "which rules
 *    were in force" for transactions that were already assessed.
 *
 *  - The effective date must fall after the latest existing version's. If it
 *    did not, the new version would be numbered higher yet lose to an older
 *    one on some dates, and two people asking the same question would get
 *    different answers.
 *
 * @param {object} args
 * @param {Array}  args.existing     every version of this club, camelCase, with effectiveDate
 * @param {string} args.clubType     Rotating, Accumulating or Burial
 * @param {object} args.changes      the fields being amended
 * @param {string} args.effectiveDate YYYY-MM-DD
 * @param {string} args.amendmentNote why the constitution is being amended
 * @param {string} args.today        YYYY-MM-DD, the club's calendar date now
 * @returns {{valid:boolean, errors:object, nextVersion:number|null, merged:object|null, changed:Array}}
 */
function validateNewVersion({ existing, clubType, changes, effectiveDate, amendmentNote, today }) {
    assertIsoDate(today, "Today");
    const errors = {};

    if (!Array.isArray(existing) || existing.length === 0) {
        return {
            valid: false,
            errors: { constitution: "This club has no constitution to amend." },
            nextVersion: null,
            merged: null,
            changed: []
        };
    }

    const latest = existing.reduce((a, b) => (b.version > a.version ? b : a));
    const nextVersion = latest.version + 1;

    // Only amendable fields are read from the request. Anything else is ignored
    // rather than trusted.
    const requested = {};
    for (const field of AMENDABLE_FIELDS) {
        if (changes && Object.prototype.hasOwnProperty.call(changes, field)) {
            requested[field] = changes[field];
        }
    }

    // Laid over the version in force TODAY rather than the highest-numbered
    // one, so an amendment starts from the rules the club is living under. When
    // a later version is already scheduled, the effective-date check below
    // refuses the amendment anyway.
    //
    // Both sides of the comparison are normalised for the club type. A version
    // written before the club type rules were applied can carry a parameter
    // that does not apply (a payout order on a burial society), and dropping it
    // is not a change the members voted on.
    const inForceNow = versionInForce(existing, today) ?? latest;
    const baseline = normaliseForClubType(clubType, inForceNow);
    const merged = normaliseForClubType(clubType, { ...baseline, ...requested });
    const changed = diffVersions(baseline, merged);

    if (changed.length === 0) {
        errors.changes = "Nothing is being changed. An amendment must change at least one parameter.";
    }

    // REQ-33.
    if (!isIsoDate(effectiveDate)) {
        errors.effectiveDate = "Give the date the amendment takes effect, as YYYY-MM-DD.";
    } else if (compareIso(effectiveDate, today) < 0) {
        errors.effectiveDate =
            "An amendment cannot take effect in the past. It applies from its effective date " +
            "onwards and never recomputes anything already assessed (REQ-33).";
    } else if (compareIso(effectiveDate, latest.effectiveDate) <= 0) {
        errors.effectiveDate =
            `Version ${latest.version} takes effect on ${latest.effectiveDate}. ` +
            "An amendment must take effect after it.";
    }

    if (!amendmentNote || !String(amendmentNote).trim()) {
        errors.amendmentNote = "Record why the constitution is being amended.";
    }

    // REQ-29: the amended set must be coherent before it is activated.
    const consistency = validateConsistency({ clubType, ...merged });
    Object.assign(errors, consistency.errors);

    return {
        valid: Object.keys(errors).length === 0,
        errors,
        nextVersion,
        merged,
        changed
    };
}

module.exports = {
    AMENDABLE_FIELDS,
    versionInForce,
    diffVersions,
    normaliseForClubType,
    validateNewVersion
};