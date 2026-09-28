"use strict";

/**
 * Officer capacity. Not in the SRS — added at the club's request, so a large
 * club can spread the Treasurer's transactional workload (and, more loosely,
 * the Secretary's) across more than one person, without ever allowing more
 * than one Chairperson.
 *
 *     maxHoldersFor()      how many of a role a club this size may have
 *     assessRoleCapacity() may this member move into this role right now
 *
 * The thresholds below are a judgement call, not a requirement copied from
 * anywhere: see decisions.md before changing them, and change them only in
 * this one place — nothing else should hardcode a number.
 *
 * Pure functions. No database, no Express.
 */

/**
 * @param {string} role Chairperson, Treasurer, Secretary or Member
 * @param {number} activeMemberCount members whose standing is not Exited
 * @returns {number} Infinity for a role with no cap (Member)
 */
function maxHoldersFor(role, activeMemberCount) {
    const count = Math.max(0, Number(activeMemberCount) || 0);
    switch (role) {
        // Exactly one, always: BR-2's dual authorisation needs a single other
        // account to approve against, which a second Chairperson would blur.
        case "Chairperson":
            return 1;
        // One Treasurer comfortably carries the transactional load (capturing
        // contributions, initiating payouts) for a club up to about 100
        // members; past that, one more per additional 100.
        case "Treasurer":
            return 1 + Math.floor(count / 100);
        // The Secretary's work (minutes, announcements, membership records)
        // does not scale with headcount the way transaction volume does; this
        // is the simpler of the two reasonable options discussed, chosen for
        // consistency with the Treasurer's rule rather than for its own
        // strong justification.
        case "Secretary":
            return 1 + Math.floor(count / 150);
        default:
            return Infinity;
    }
}

/**
 * @param {object} f
 * @param {string} f.role the role being assigned
 * @param {number} f.currentHolders how many already hold it (this member is not among them)
 * @param {number} f.activeMemberCount
 * @returns {{eligible:boolean, refusals:Array}}
 */
function assessRoleCapacity(f) {
    const max = maxHoldersFor(f.role, f.activeMemberCount);
    if (f.currentHolders >= max) {
        return {
            eligible: false,
            refusals: [{
                requirement: "BR-officer-capacity",
                code: "ROLE_AT_CAPACITY",
                message:
                    `This club already has ${f.currentHolders} member${f.currentHolders === 1 ? "" : "s"} holding the ` +
                    `${f.role} role, the maximum for ${f.activeMemberCount} member${f.activeMemberCount === 1 ? "" : "s"}. ` +
                    (max === 1
                        ? `A club has exactly one ${f.role}.`
                        : `Appoint one once membership grows, or move an existing ${f.role} to another role first.`)
            }]
        };
    }
    return { eligible: true, refusals: [] };
}

module.exports = { maxHoldersFor, assessRoleCapacity };