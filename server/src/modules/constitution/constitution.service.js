"use strict";

/**
 * Constitution service. Rules Engine, SRS 4.4.2.
 *
 *     getVersionInForceOn()   REQ-31
 *     listVersions()          REQ-30
 *     createNewVersion()      REQ-30, REQ-32, REQ-33
 *
 * No Express in this file.
 *
 * createNewVersion() has no HTTP route yet, on purpose. REQ-32 says an
 * amendment takes effect only once a member resolution has met the quorum and
 * majority thresholds. Until the governance module (Use Case 7) exists to
 * record that resolution, a route here would let an officer amend the
 * constitution without one. Governance calls this function when a resolution
 * is given effect.
 */

const repo = require("./constitution.repo");
const { withClubTransaction } = require("../../db/tx");
const { toCents, toNumeric } = require("../../lib/money");
const { assertIsoDate, todayIso } = require("../../lib/dates");
const { versionInForce, validateNewVersion } = require("../../rules/versioning");
const { BadRequest, RuleRefusal } = require("../../lib/errors");

function requireDate(value, label) {
    try {
        return assertIsoDate(value, label);
    } catch (err) {
        throw new BadRequest(err.message);
    }
}

async function listVersions(db) {
    return repo.listVersions(db);
}

/**
 * The version in force on a date, or null if the club had no constitution yet.
 * Omit the date for today.
 */
async function findVersionInForceOn(db, date = null) {
    const onDate = date === null ? todayIso() : requireDate(date, "The date");
    return versionInForce(await repo.listVersions(db), onDate);
}

/**
 * The version in force on a date. Refuses if there was none, because a rule
 * cannot be assessed against a constitution that did not exist.
 *
 * Every rule that depends on the constitution asks this function for the date
 * of the transaction under consideration, and never for "the current version"
 * (REQ-31).
 */
async function getVersionInForceOn(db, date = null) {
    const onDate = date === null ? todayIso() : requireDate(date, "The date");
    const version = versionInForce(await repo.listVersions(db), onDate);
    if (!version) {
        throw new RuleRefusal(
            `This club had no constitution in force on ${onDate}.`,
            { requirement: "REQ-31", date: onDate }
        );
    }
    return version;
}

/**
 * Records an amendment as the next version. Never edits an existing one.
 *
 * The caller must already have established that a resolution meeting the
 * quorum and majority thresholds adopted this amendment (REQ-32).
 *
 * @param {object} args
 * @param {object} args.changes        the parameters being amended
 * @param {string} args.effectiveDate  YYYY-MM-DD, today or later
 * @param {string} args.amendmentNote  why
 */
async function createNewVersion(db, { changes, effectiveDate, amendmentNote }, { actor, audit }) {
    const today = todayIso();

    const outcome = await withClubTransaction(db.clubId, async (tx) => {
        // Serialise amendments to this club. Without the lock, two concurrent
        // amendments would both compute the same next version number and one
        // would fail on the database's unique constraint with an error nobody
        // can act on.
        const club = await repo.lockClub(tx);
        const existing = await repo.listVersions(tx);

        const check = validateNewVersion({
            existing,
            clubType: club.club_type,
            changes,
            effectiveDate,
            amendmentNote,
            today
        });
        if (!check.valid) return { check };

        const latest = existing[existing.length - 1];
        const m = check.merged;

        const created = await repo.insertVersion(tx, {
            version: check.nextVersion,
            effectiveDate,
            contributionAmount: toNumeric(toCents(m.contributionAmount)),
            cycleFrequency: m.cycleFrequency,
            // The anchor date for cycles is fixed for the life of the club.
            cycleStartDate: latest.cycleStartDate,
            penaltyAmount: toNumeric(toCents(m.penaltyAmount || 0)),
            gracePeriodDays: Number(m.gracePeriodDays ?? 0),
            quorumPercentage: Number(m.quorumPercentage),
            exitNoticeDays: Number(m.exitNoticeDays ?? 0),
            payoutOrderMethod: m.payoutOrderMethod,
            forfeitureRule: m.forfeitureRule?.trim?.() || null,
            waitingPeriodDays: Number(m.waitingPeriodDays ?? 0),
            benefitSchedule: m.benefitSchedule,
            yearEndMonth: m.yearEndMonth,
            yearEndDay: m.yearEndDay,
            amendmentNote: String(amendmentNote).trim(),
            adoptedBy: actor.userId
        });

        return { check, created };
    });

    if (!outcome.check.valid) {
        await audit("constitution.amend", "Refused", {
            detail: `Refused: ${Object.values(outcome.check.errors).join(" ")}`,
            targetType: "constitution",
            targetId: null
        });
        throw new RuleRefusal(
            "That amendment cannot be recorded.",
            { requirement: "REQ-29, REQ-30, REQ-33", errors: outcome.check.errors }
        );
    }

    const { created, check } = outcome;
    await audit("constitution.amend", "Success", {
        detail:
            `${actor.fullName} recorded version ${created.version}, effective ${created.effectiveDate}. ` +
            `Changed: ${check.changed.map((c) => c.field).join(", ")}`,
        targetType: "constitution",
        targetId: created.constitutionId
    });

    return { constitution: created, changed: check.changed };
}

module.exports = {
    listVersions,
    findVersionInForceOn,
    getVersionInForceOn,
    createNewVersion
};