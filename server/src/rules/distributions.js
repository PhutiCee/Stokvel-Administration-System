"use strict";

/**
 * Year-end distribution rules. REQ-79 to REQ-82. SDD: computeDistributionShare().
 *
 *     allocateProportionally()   split a total in cents with no rounding loss
 *     computeShares()            REQ-80: each member's share
 *     assessDistribution()       REQ-79, REQ-81: is this distribution allowed
 *     describeDistributionRule() REQ-82: the rule as recorded and shown
 *
 * REQ-80's formula: captured contributions, less unwaived penalties, plus a
 * proportionate share of interest, less a proportionate share of admin costs.
 * The SRS does not say what "proportionate" is proportionate TO. This uses
 * each member's own net contribution (captured less penalties, floored at
 * zero) as the weight, so a member who contributed more of the pool carries
 * more of the interest it earned and more of the cost of running it. See
 * decisions.md.
 *
 * REQ-81 requires the sum of every member's share to equal the pool exactly,
 * not approximately. Splitting a total proportionally in whole cents cannot
 * generally be done without a remainder — three ways splitting 100 cents each
 * get 33.33. allocateProportionally() uses the largest-remainder method: every
 * member gets the whole cents they are clearly owed, and the few cents left
 * over from rounding go one each to the members whose true share was closest
 * to rounding up, until none are left. The total placed is always exactly the
 * total given.
 *
 * Pure functions. No database, no Express.
 */

/**
 * Splits totalCents among weights, proportionally, with no cent unaccounted
 * for. Every weight must be a non-negative integer. Returns null if totalCents
 * is not zero but every weight is zero — there is no basis to split by, and
 * the caller must decide what that means for that distribution.
 *
 * @param {number} totalCents non-negative integer
 * @param {number[]} weights non-negative integers, same length as the output
 * @returns {number[]|null}
 */
function allocateProportionally(totalCents, weights) {
    if (!Number.isInteger(totalCents) || totalCents < 0) {
        throw new TypeError("totalCents must be a non-negative integer.");
    }
    if (weights.some((w) => !Number.isInteger(w) || w < 0)) {
        throw new TypeError("Every weight must be a non-negative integer.");
    }
    if (weights.length === 0) return [];

    const sumWeights = weights.reduce((a, b) => a + b, 0);
    if (sumWeights === 0) return totalCents === 0 ? weights.map(() => 0) : null;

    // Integer division throughout: floor_i is the whole cents this weight is
    // clearly owed, and remainder_i (out of sumWeights, not out of 1) ranks how
    // close each member was to the next whole cent, without ever going through
    // a floating-point fraction.
    const rows = weights.map((w) => {
        const numerator = totalCents * w;
        const floor = Math.trunc(numerator / sumWeights);
        return { floor, remainder: numerator - floor * sumWeights };
    });

    const allocated = rows.reduce((a, r) => a + r.floor, 0);
    let leftover = totalCents - allocated;

    const byRemainder = rows
        .map((r, i) => ({ i, remainder: r.remainder }))
        .sort((a, b) => b.remainder - a.remainder || a.i - b.i);

    for (let k = 0; k < leftover; k++) rows[byRemainder[k].i].floor += 1;

    return rows.map((r) => r.floor);
}

/**
 * REQ-80. Every amount in integer cents; the caller converts.
 *
 * @param {Array<{memberId:string, fullName:string, capturedCents:number, penaltyCents:number}>} members
 * @param {number} interestCents total for the period, non-negative
 * @param {number} expenseCents total for the period, non-negative
 * @returns {{ok:boolean, reason?:string, perMember?:Array, totalFinalCents?:number}}
 */
function computeShares({ members, interestCents, expenseCents }) {
    const baseCents = members.map((m) => m.capturedCents - m.penaltyCents);
    const weights = baseCents.map((b) => Math.max(b, 0));

    const interestShares = allocateProportionally(interestCents, weights);
    const expenseShares = allocateProportionally(expenseCents, weights);
    if (interestShares === null || expenseShares === null) {
        return {
            ok: false,
            reason:
                "No member has a positive net contribution for this period, so interest and administrative " +
                "costs have no basis to be shared by. This distribution needs at least one member with " +
                "contributions exceeding their unwaived penalties."
        };
    }

    const perMember = members.map((m, i) => ({
        memberId: m.memberId,
        fullName: m.fullName,
        capturedCents: m.capturedCents,
        penaltyCents: m.penaltyCents,
        baseCents: baseCents[i],
        interestShareCents: interestShares[i],
        expenseShareCents: expenseShares[i],
        finalCents: baseCents[i] + interestShares[i] - expenseShares[i]
    }));

    return {
        ok: true,
        perMember,
        totalFinalCents: perMember.reduce((a, m) => a + m.finalCents, 0)
    };
}

/**
 * @param {object} f
 * @param {string} f.clubType
 * @param {string|null} f.yearEndDate  the year-end date being distributed for, once due
 * @param {boolean} f.isDue            today is on or after f.yearEndDate
 * @param {boolean} f.alreadyDistributed  this year-end date already has a live distribution
 * @param {Array} f.members
 * @param {number} f.interestCents
 * @param {number} f.expenseCents
 * @param {number} f.poolCents
 * @returns {{eligible:boolean, refusals:Array, shares:object|null}}
 */
function assessDistribution(f) {
    const refusals = [];
    const refuse = (requirement, code, message) => refusals.push({ requirement, code, message });

    if (f.clubType !== "Accumulating") {
        refuse("REQ-79", "NOT_ACCUMULATING", "Only an accumulating club distributes the pool at year-end.");
    }
    if (!f.yearEndDate) {
        refuse("REQ-79", "NO_YEAR_END_DATE", "This club's constitution does not name a year-end date.");
    } else if (!f.isDue) {
        refuse("REQ-79", "NOT_YET_DUE", `The next distribution falls due on ${f.yearEndDate}, not before.`);
    } else if (f.alreadyDistributed) {
        refuse("REQ-79", "ALREADY_DISTRIBUTED", `The distribution for ${f.yearEndDate} has already been made.`);
    }
    if (!f.members || f.members.length === 0) {
        refuse("REQ-79", "NO_MEMBERS", "This club has no members to distribute to.");
    }

    let shares = null;
    if (f.members && f.members.length > 0) {
        const computed = computeShares({ members: f.members, interestCents: f.interestCents, expenseCents: f.expenseCents });
        if (!computed.ok) {
            refuse("REQ-80", "NO_ALLOCATION_BASIS", computed.reason);
        } else {
            shares = computed;
            const negative = computed.perMember.filter((m) => m.finalCents < 0);
            if (negative.length > 0) {
                refuse(
                    "REQ-80", "NEGATIVE_SHARE",
                    `${negative.map((m) => m.fullName).join(", ")} would be owed a negative share: penalties ` +
                    "exceed contributions by more than this distribution can absorb. The club must recover " +
                    "or waive those penalties before this distribution can proceed."
                );
            }
            // REQ-81, checked before the pool comparison below can even be
            // meaningful: the arithmetic itself must be exact.
            if (computed.totalFinalCents !== f.poolCents) {
                refuse(
                    "REQ-81", "POOL_MISMATCH",
                    `The computed shares sum to ${computed.totalFinalCents} cents, which does not equal the ` +
                    `pool balance of ${f.poolCents} cents. This distribution cannot be posted until the figures ` +
                    "reconcile exactly."
                );
            }
        }
    }

    return { eligible: refusals.length === 0, refusals, shares };
}

function describeDistributionRule({ constitutionVersion, yearEndDate }) {
    return (
        `Accumulating club, constitution version ${constitutionVersion}. Year-end distribution for ${yearEndDate}: ` +
        "each member receives their captured contributions, less unwaived penalties, plus their proportionate " +
        "share of interest earned, less their proportionate share of administrative costs, apportioned by each " +
        "member's own net contribution for the period."
    );
}

module.exports = { allocateProportionally, computeShares, assessDistribution, describeDistributionRule };