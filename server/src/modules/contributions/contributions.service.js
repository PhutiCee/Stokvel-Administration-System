"use strict";

/**
 * Cycles and contributions service. Use Case 2.
 *
 *     openCycle()                      REQ-50, REQ-59
 *     generateExpectedContributions()  REQ-50
 *     captureContribution()            REQ-51, REQ-52, REQ-59, REQ-60
 *     resolveStatus()                  REQ-54, REQ-55   (rules/contributions.js)
 *     applyExcess()                    REQ-57
 *
 * No Express in this file.
 */

const repo = require("./contributions.repo");
const ledger = require("../ledger/ledger.service");
const { withClubTransaction } = require("../../db/tx");
const { toCents, toNumeric, format } = require("../../lib/money");
const {
    resolveStatus, lateFrom, penaltyIsDue, checkCaptureAmount, checkMethod
} = require("../../rules/contributions");
const { BadRequest, Conflict, NotFound, RuleRefusal } = require("../../lib/errors");

const iso = (d) => new Date(d).toISOString().slice(0, 10);

// ---------------------------------------------------------------------------
// openCycle() + generateExpectedContributions()
// ---------------------------------------------------------------------------

/**
 * Opening a cycle and generating its expected contributions are ONE operation,
 * in one transaction. REQ-50 says the records are generated "at the
 * commencement of each cycle", so a cycle that exists without them has never
 * been in a state the requirement permits.
 *
 * At most one cycle per club may be Open. That is enforced by a partial unique
 * index (migration 005), not by the check below — two treasurers pressing the
 * button at the same moment would both pass a service-level check, and only the
 * database can settle it.
 */
async function openCycle(db, { startDate, dueDate }, { actor, audit }) {
    const constitution = await repo.constitutionInForceOn(db);
    if (!constitution) {
        throw new RuleRefusal("This club has no constitution on record, so a cycle cannot be opened.");
    }

    const existing = await repo.openCycleFor(db);
    if (existing) {
        throw new Conflict(
            `Cycle ${existing.sequence_number} is still open. Close it before opening another.`,
            { cycleId: existing.cycle_id, sequenceNumber: existing.sequence_number }
        );
    }

    const start = startDate ? iso(startDate) : iso(new Date());
    const due = dueDate ? iso(dueDate) : iso(new Date(new Date(start).getTime() + 7 * 86400000));

    if (new Date(due) < new Date(start)) {
        throw new BadRequest("The due date cannot fall before the cycle starts.");
    }

    const members = await repo.membersForNewCycle(db);
    if (members.length === 0) {
        throw new RuleRefusal(
            "No member of this club is in good standing, so there is nobody to bill. " +
            "Register members or restore standing first."
        );
    }

    const contributionCents = toCents(constitution.contribution_amount);
    const sequenceNumber = await repo.nextSequenceNumber(db);

    const result = await withClubTransaction(db.clubId, async (tx) => {
        const cycle = await repo.createCycle(tx, {
            sequenceNumber, startDate: start, dueDate: due, openedBy: actor.userId
        });

        let billedCents = 0;
        let creditsApplied = 0;

        for (const m of members) {
            // REQ-41: a catch-up obligation agreed at registration is added to
            // the member's first bill.
            const catchUpCents = toCents(m.catch_up_amount);

            // REQ-57: a credit carried from an earlier overpayment reduces it.
            const creditCents = toCents(m.credit_amount);

            const grossCents = contributionCents + catchUpCents;
            const appliedCredit = Math.min(creditCents, grossCents);
            const expectedCents = grossCents - appliedCredit;

            await repo.insertExpected(tx, {
                cycleId: cycle.cycle_id,
                memberId: m.member_id,
                expectedAmount: toNumeric(expectedCents)
            });

            if (appliedCredit > 0) {
                await repo.addCredit(tx, m.member_id, toNumeric(creditCents - appliedCredit));
                creditsApplied += appliedCredit;
            }
            // The catch-up has now been billed, so it is cleared.
            if (catchUpCents > 0) {
                await tx.query(
                    `UPDATE member SET catch_up_amount = 0
                      WHERE club_id = $1 AND member_id = $2`,
                    [tx.clubId, m.member_id]
                );
            }

            billedCents += expectedCents;
        }

        return { cycle, billedCents, creditsApplied };
    });

    await audit("cycle.open", "Success", {
        detail:
            `${actor.fullName} opened cycle ${sequenceNumber} (${start} to ${due}), ` +
            `billing ${members.length} member(s) ${format(result.billedCents)}` +
            (result.creditsApplied ? `, after ${format(result.creditsApplied)} of credits` : ""),
        targetType: "cycle",
        targetId: result.cycle.cycle_id
    });

    return {
        cycleId: result.cycle.cycle_id,
        sequenceNumber,
        startDate: start,
        dueDate: due,
        memberCount: members.length,
        expectedTotal: toNumeric(result.billedCents),
        creditsApplied: toNumeric(result.creditsApplied)
    };
}

// ---------------------------------------------------------------------------
// applyExcess() — REQ-57
// ---------------------------------------------------------------------------

/**
 * An overpayment is applied, in this order:
 *
 *   1. any outstanding penalty, oldest first
 *   2. any prior outstanding contribution, in order of age
 *   3. whatever remains, as a credit against the succeeding cycle
 *
 * NO LEDGER ENTRIES ARE WRITTEN HERE, and that is deliberate. The cash arrived
 * once and was recorded once by the caller. What happens below is allocation —
 * deciding which debts that one payment answers. Posting a further entry for
 * each allocation would count the same money into the pool several times and
 * the balance would be wrong.
 *
 * Runs inside the caller's transaction.
 *
 * @returns {{allocations: Array, creditCents: number}}
 */
async function applyExcess(tx, { memberId, excessCents, excludeContributionId }) {
    const allocations = [];
    let remaining = excessCents;

    // 1. Penalties.
    if (remaining > 0) {
        const penalties = await repo.unsettledPenalties(tx, memberId);
        for (const p of penalties) {
            if (remaining <= 0) break;
            const owingCents = toCents(p.amount) - toCents(p.settled_amount);
            if (owingCents <= 0) continue;

            const payCents = Math.min(remaining, owingCents);
            await repo.settlePenalty(tx, p.penalty_id, toNumeric(toCents(p.settled_amount) + payCents));
            remaining -= payCents;

            allocations.push({
                type: "penalty",
                id: p.penalty_id,
                amount: toNumeric(payCents),
                description: `Penalty: ${p.reason}`,
                settledInFull: payCents === owingCents
            });
        }
    }

    // 2. Prior outstanding contributions, oldest first.
    if (remaining > 0) {
        const prior = await repo.priorOutstanding(tx, memberId, excludeContributionId);
        for (const c of prior) {
            if (remaining <= 0) break;
            const shortCents = toCents(c.expected_amount) - toCents(c.captured_amount);
            if (shortCents <= 0) continue;

            const payCents = Math.min(remaining, shortCents);
            const newCapturedCents = toCents(c.captured_amount) + payCents;

            await tx.query(
                `UPDATE contribution
                    SET captured_amount = $3, updated_at = now()
                  WHERE club_id = $1 AND contribution_id = $2`,
                [tx.clubId, c.contribution_id, toNumeric(newCapturedCents)]
            );

            // The status of that older cycle has changed, so it is recomputed
            // rather than left stale (REQ-54).
            const constitution = await repo.constitutionInForceOn(tx, iso(c.due_date));
            const status = resolveStatus({
                expected: c.expected_amount,
                captured: toNumeric(newCapturedCents),
                dueDate: c.due_date,
                graceDays: constitution?.grace_period_days || 0
            });
            await repo.setStatus(tx, c.contribution_id, status);

            remaining -= payCents;
            allocations.push({
                type: "contribution",
                id: c.contribution_id,
                amount: toNumeric(payCents),
                description: `Arrears from cycle ${c.sequence_number}`,
                settledInFull: payCents === shortCents
            });
        }
    }

    // 3. Whatever is left is a credit against the next cycle.
    if (remaining > 0) {
        const member = await repo.getMemberCredit(tx, memberId);
        const newCreditCents = toCents(member.credit_amount) + remaining;
        await repo.addCredit(tx, memberId, toNumeric(newCreditCents));
        allocations.push({
            type: "credit",
            id: memberId,
            amount: toNumeric(remaining),
            description: "Credit against the next cycle",
            settledInFull: true
        });
    }

    return { allocations, creditCents: remaining };
}

// ---------------------------------------------------------------------------
// captureContribution() — REQ-51, REQ-52, REQ-59, REQ-60
// ---------------------------------------------------------------------------

async function captureContribution(db, contributionId, input, { actor, audit }) {
    // --- refusals, before anything is written ---
    const amountError = checkCaptureAmount(input.amount);        // REQ-60
    if (amountError) throw new BadRequest(amountError, { fields: { amount: amountError } });

    const methodError = checkMethod(input.method, input.reference); // REQ-52
    if (methodError) throw new BadRequest("Some details need correcting.", { fields: methodError });

    const existing = await repo.getContribution(db, contributionId);
    if (!existing) throw new NotFound("That contribution was not found in this club.");

    // REQ-59.
    if (existing.cycle_status === "Closed") {
        throw new RuleRefusal(
            `Cycle ${existing.sequence_number} is closed. A correction to a closed cycle needs a ` +
            `reversing entry followed by a fresh capture, so that the original record survives.`,
            { requirement: "REQ-59" }
        );
    }

    const constitution = await repo.constitutionInForceOn(db, iso(existing.due_date));
    const graceDays = constitution?.grace_period_days || 0;
    const penaltyCents = toCents(constitution?.penalty_amount || 0);

    const amountCents = toCents(input.amount);
    const expectedCents = toCents(existing.expected_amount);
    const alreadyCents = toCents(existing.captured_amount);

    // The amount that answers THIS cycle, and the amount that overflows it.
    const shortfallCents = Math.max(0, expectedCents - alreadyCents);
    const appliedCents = Math.min(amountCents, shortfallCents);
    const excessCents = amountCents - appliedCents;

    const receiptDate = input.receiptDate ? iso(input.receiptDate) : iso(new Date());

    // REQ-56 attaches the penalty to HAVING BEEN late, so it is decided from the
    // member's position BEFORE this payment, not after it.
    //
    // Keying it to the post-capture status was a defect: a member who let the
    // deadline pass and then paid in full would resolve straight to Paid and
    // escape the penalty, which is precisely the person the rule exists for.
    const statusBefore = resolveStatus({
        expected: existing.expected_amount,
        captured: existing.captured_amount,
        dueDate: existing.due_date,
        graceDays
    });

    const result = await withClubTransaction(db.clubId, async (tx, client) => {
        const newCapturedCents = alreadyCents + appliedCents;

        const status = resolveStatus({
            expected: existing.expected_amount,
            captured: toNumeric(newCapturedCents),
            dueDate: existing.due_date,
            graceDays
        });

        await repo.applyCapture(tx, contributionId, {
            capturedAmount: toNumeric(newCapturedCents),
            status,
            receiptDate,
            method: input.method,
            reference: input.reference || null,
            capturedBy: actor.userId
        });

        // ONE ledger entry, for the cash actually received. The allocation of
        // that cash below does not move money and does not post entries.
        const entry = await ledger.appendEntry(client, {
            clubId: tx.clubId,
            memberId: existing.member_id,
            entryType: "Contribution",
            amount: toNumeric(amountCents),
            description: `Contribution, cycle ${existing.sequence_number} — ${existing.full_name}`,
            reference: input.reference || null,
            contributionId,
            postedBy: actor.userId
        });

        // REQ-57.
        let excess = { allocations: [], creditCents: 0 };
        if (excessCents > 0) {
            excess = await applyExcess(tx, {
                memberId: existing.member_id,
                excessCents,
                excludeContributionId: contributionId
            });
        }

        // REQ-56, posted once only. The unique index from migration 009 makes a
        // repeat impossible even when two captures race.
        //
        // A member who never pays at all is not reached here, because nothing
        // triggers a capture for them. Their penalty is levied when the cycle
        // closes — closeCycle() sweeps the unpaid and is scheduled for the next
        // sprint. Until then their status still READS as Late everywhere,
        // because it is recomputed on every read.
        let penalty = null;
        if (penaltyIsDue(statusBefore) && penaltyCents > 0) {
            penalty = await repo.levyPenalty(tx, {
                memberId: existing.member_id,
                cycleId: existing.cycle_id,
                amount: toNumeric(penaltyCents),
                reason: `Late contribution, cycle ${existing.sequence_number}`
            });
            if (penalty) {
                await ledger.appendEntry(client, {
                    clubId: tx.clubId,
                    memberId: existing.member_id,
                    entryType: "Penalty",
                    amount: toNumeric(penaltyCents),
                    description: `Late penalty, cycle ${existing.sequence_number} — ${existing.full_name}`,
                    penaltyId: penalty.penalty_id,
                    postedBy: actor.userId
                });
            }
        }

        return { status, newCapturedCents, entry, excess, penalty };
    });

    await audit("contribution.capture", "Success", {
        detail:
            `${actor.fullName} captured ${format(amountCents)} from ${existing.full_name} ` +
            `for cycle ${existing.sequence_number} (${input.method}). Status: ${result.status}.` +
            (excessCents > 0 ? ` Excess ${format(excessCents)} reallocated.` : "") +
            (result.penalty ? ` Late penalty ${format(penaltyCents)} levied.` : ""),
        targetType: "contribution",
        targetId: contributionId
    });

    return {
        contributionId,
        memberName: existing.full_name,
        captured: toNumeric(result.newCapturedCents),
        expected: existing.expected_amount,
        status: result.status,
        amountReceived: toNumeric(amountCents),
        appliedToThisCycle: toNumeric(appliedCents),
        excess: toNumeric(excessCents),
        allocations: result.excess.allocations,
        penaltyLevied: result.penalty ? toNumeric(penaltyCents) : null,
        ledger: {
            entryId: result.entry.entryId,
            resultingBalance: result.entry.resultingBalance
        }
    };
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

async function listCycles(db) {
    const rows = await repo.listCycles(db);
    return rows.map((c) => ({
        cycleId: c.cycle_id,
        sequenceNumber: c.sequence_number,
        startDate: c.start_date,
        dueDate: c.due_date,
        status: c.status,
        memberCount: c.member_count,
        expectedTotal: c.expected_total,
        capturedTotal: c.captured_total
    }));
}

async function getCycleDetail(db, cycleId) {
    const cycle = cycleId
        ? await repo.getCycle(db, cycleId)
        : await repo.openCycleFor(db);

    if (!cycle) return null;

    const constitution = await repo.constitutionInForceOn(db, iso(cycle.due_date));
    const graceDays = constitution?.grace_period_days || 0;
    const rows = await repo.listForCycle(db, cycle.cycle_id);

    return {
        cycle: {
            cycleId: cycle.cycle_id,
            sequenceNumber: cycle.sequence_number,
            startDate: cycle.start_date,
            dueDate: cycle.due_date,
            status: cycle.status,
            lateFrom: iso(lateFrom(cycle.due_date, graceDays)),
            gracePeriodDays: graceDays,
            penaltyAmount: constitution?.penalty_amount || "0.00"
        },
        contributions: rows.map((r) => ({
            contributionId: r.contribution_id,
            memberId: r.member_id,
            fullName: r.full_name,
            phone: r.phone,
            standing: r.standing,
            expected: r.expected_amount,
            captured: r.captured_amount,
            // Recomputed on read, so a status does not go stale merely because
            // nobody has touched the record since the deadline passed (REQ-54).
            status: resolveStatus({
                expected: r.expected_amount,
                captured: r.captured_amount,
                dueDate: cycle.due_date,
                graceDays
            }),
            storedStatus: r.status,
            receiptDate: r.receipt_date,
            method: r.method,
            reference: r.reference
        }))
    };
}

module.exports = {
    openCycle,
    captureContribution,
    applyExcess,
    listCycles,
    getCycleDetail
};