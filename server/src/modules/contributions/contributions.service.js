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
const compensation = require("../ledger/compensation.repo");
const { withClubTransaction } = require("../../db/tx");
const { toCents, toNumeric, format } = require("../../lib/money");
const {
  resolveStatus,
  lateFrom,
  penaltyIsDue,
  checkCaptureAmount,
  checkMethod,
} = require("../../rules/contributions");
const { assessWaiver } = require("../../rules/penalties");
const {
  BadRequest,
  Conflict,
  NotFound,
  RuleRefusal,
} = require("../../lib/errors");

const { assertIsoDate, todayIso, addDays } = require("../../lib/dates");
function inputDate(value, label) {
  try {
    return assertIsoDate(value, label);
  } catch (err) {
    throw new BadRequest(err.message);
  }
}

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
  const start = startDate ? inputDate(startDate, "Cycle start") : todayIso();
  if (start > todayIso())
    throw new RuleRefusal(
      "A cycle cannot be opened before its commencement date.",
    );
  const due = dueDate ? inputDate(dueDate, "Due date") : addDays(start, 7);
  if (due < start)
    throw new BadRequest("The due date cannot fall before the cycle starts.");
  const result = await withClubTransaction(db.clubId, async (tx) => {
    await repo.lockClub(tx);
    const constitution = await repo.constitutionForStart(tx, start);
    if (!constitution)
      throw new RuleRefusal(
        "No constitution applies to this cycle commencement date.",
      );
    const existing = await repo.openCycleFor(tx);
    if (existing)
      throw new Conflict(
        `Cycle ${existing.sequence_number} is still open. Close it first.`,
      );
    const members = await repo.membersForNewCycle(tx);
    if (members.length === 0) {
      throw new RuleRefusal(
        "No member of this club is in good standing, so there is nobody to bill. " +
          "Register members or restore standing first.",
      );
    }

    const contributionCents = toCents(constitution.contribution_amount);
    const sequenceNumber = await repo.nextSequenceNumber(tx);

    const cycle = await repo.createCycle(tx, {
      sequenceNumber,
      startDate: start,
      dueDate: due,
      openedBy: actor.userId,
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

      const expected = await repo.insertExpected(tx, {
        cycleId: cycle.cycle_id,
        memberId: m.member_id,
        expectedAmount: toNumeric(expectedCents),
      });

      if (appliedCredit > 0) {
        await compensation.applyCredits(tx, m.member_id, expected.contribution_id, creditCents, appliedCredit);
        await repo.addCredit(
          tx,
          m.member_id,
          toNumeric(creditCents - appliedCredit),
        );
        creditsApplied += appliedCredit;
      }
      // The catch-up has now been billed, so it is cleared.
      if (catchUpCents > 0) {
        await tx.query(
          `UPDATE member SET catch_up_amount = 0
                      WHERE club_id = $1 AND member_id = $2`,
          [tx.clubId, m.member_id],
        );
      }

      billedCents += expectedCents;
    }

    return {
      cycle,
      billedCents,
      creditsApplied,
      sequenceNumber,
      memberCount: members.length,
    };
  });

  await audit("cycle.open", "Success", {
    detail:
      `${actor.fullName} opened cycle ${result.sequenceNumber} (${start} to ${due}), ` +
      `billing ${result.memberCount} member(s) ${format(result.billedCents)}` +
      (result.creditsApplied
        ? `, after ${format(result.creditsApplied)} of credits`
        : ""),
    targetType: "cycle",
    targetId: result.cycle.cycle_id,
  });

  return {
    cycleId: result.cycle.cycle_id,
    sequenceNumber: result.sequenceNumber,
    startDate: start,
    dueDate: due,
    memberCount: result.memberCount,
    expectedTotal: toNumeric(result.billedCents),
    creditsApplied: toNumeric(result.creditsApplied),
  };
}

// Closure sweeps every bill, including members who never made a payment.
async function closeCycle(db, cycleId, { actor, audit }) {
  try {
    const result = await withClubTransaction(db.clubId, async (tx) => {
      await repo.lockClub(tx);
      const cycle = await repo.getCycle(tx, cycleId);
      if (!cycle) throw new NotFound("That cycle was not found in this club.");
      if (cycle.status !== "Open") throw new Conflict("This cycle is already closed.");
      const constitution = await repo.constitutionForCycle(tx, cycleId);
      const graceDays = constitution.grace_period_days;
      const rows = await repo.listForCycle(tx, cycleId);
      const outstanding = rows.some(r => toCents(r.captured_amount) + toCents(r.written_off_amount || '0') < toCents(r.expected_amount));
      if (outstanding && todayIso() < addDays(cycle.due_date, Number(graceDays) + 1))
        throw new RuleRefusal("Unpaid contributions still have time to be received. Close this cycle after its due date and grace period, or after every obligation is paid or written off.");
      let penaltiesLevied = 0;
      for (const row of rows) {
        const expected = toNumeric(Math.max(0, toCents(row.expected_amount) - toCents(row.written_off_amount || '0')));
        const status = resolveStatus({expected,captured:row.captured_amount,dueDate:cycle.due_date,graceDays});
        await repo.setStatus(tx, row.contribution_id, status);
        if (penaltyIsDue(status) && !['Exited','Expelled'].includes(row.standing) && toCents(row.written_off_amount || '0') === 0) {
          const penalty = await levyLatePenalty(tx, { ...row, cycle_id:cycleId, sequence_number:cycle.sequence_number }, constitution.penalty_amount, actor);
          if (penalty) penaltiesLevied++;
        }
      }
      const closed = await repo.closeCycle(tx,cycleId,actor.userId);
      return {cycleId,sequenceNumber:closed.sequence_number,status:'Closed',closedAt:closed.closed_at,penaltiesLevied};
    });
    await audit('cycle.close','Success',{targetType:'cycle',targetId:cycleId,detail:`${actor.fullName} closed cycle ${result.sequenceNumber}; ${result.penaltiesLevied} late penalties assessed. Unpaid debts remain due.`});
    return result;
  } catch (err) {
    if (err.status) await audit('cycle.close','Refused',{targetType:'cycle',targetId:cycleId,detail:err.message});
    throw err;
  }
}

async function levyLatePenalty(tx, contribution, amount, actor) {
  if (toCents(amount || '0') <= 0) return null;
  const penalty = await repo.levyPenalty(tx, {
    memberId:contribution.member_id,cycleId:contribution.cycle_id,amount,
    reason:`Late contribution, cycle ${contribution.sequence_number}`,
  });
  if (penalty) await ledger.appendEntry(tx, {
    clubId:tx.clubId,memberId:contribution.member_id,entryType:'Penalty',amount,
    description:`Late penalty assessment, cycle ${contribution.sequence_number} — ${contribution.full_name}`,
    penaltyId:penalty.penalty_id,postedBy:actor.userId,
  });
  return penalty;
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
async function applyExcess(
  tx,
  { memberId, excessCents, excludeContributionId },
) {
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
      await repo.settlePenalty(
        tx,
        p.penalty_id,
        toNumeric(toCents(p.settled_amount) + payCents),
      );
      remaining -= payCents;

      allocations.push({
        type: "penalty",
        id: p.penalty_id,
        amount: toNumeric(payCents),
        description: `Penalty: ${p.reason}`,
        settledInFull: payCents === owingCents,
      });
    }
  }

  // 2. Prior outstanding contributions, oldest first.
  if (remaining > 0) {
    const prior = await repo.priorOutstanding(
      tx,
      memberId,
      excludeContributionId,
    );
    for (const c of prior) {
      if (remaining <= 0) break;
      const shortCents =
        toCents(c.expected_amount) - toCents(c.captured_amount);
      if (shortCents <= 0) continue;

      const payCents = Math.min(remaining, shortCents);
      const newCapturedCents = toCents(c.captured_amount) + payCents;

      await tx.query(
        `UPDATE contribution
                    SET captured_amount = $3, updated_at = now()
                  WHERE club_id = $1 AND contribution_id = $2`,
        [tx.clubId, c.contribution_id, toNumeric(newCapturedCents)],
      );

      // The status of that older cycle has changed, so it is recomputed
      // rather than left stale (REQ-54).
      const constitution = await repo.constitutionForCycle(tx, c.cycle_id);
      const status = resolveStatus({
        expected: c.expected_amount,
        captured: toNumeric(newCapturedCents),
        dueDate: c.due_date,
        graceDays: constitution?.grace_period_days || 0,
      });
      await repo.setStatus(tx, c.contribution_id, status);

      remaining -= payCents;
      allocations.push({
        type: "contribution",
        id: c.contribution_id,
        amount: toNumeric(payCents),
        description: `Arrears from cycle ${c.sequence_number}`,
        settledInFull: payCents === shortCents,
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
      settledInFull: true,
    });
  }

  return { allocations, creditCents: remaining };
}

// ---------------------------------------------------------------------------
// captureContribution() — REQ-51, REQ-52, REQ-59, REQ-60
// ---------------------------------------------------------------------------

async function captureContribution(
  db,
  contributionId,
  input,
  { actor, audit },
) {
  // --- refusals, before anything is written ---
  const amountError = checkCaptureAmount(input.amount); // REQ-60
  if (amountError)
    throw new BadRequest(amountError, { fields: { amount: amountError } });

  const methodError = checkMethod(input.method, input.reference); // REQ-52
  if (methodError)
    throw new BadRequest("Some details need correcting.", {
      fields: methodError,
    });

  const existing = await repo.getContribution(db, contributionId);
  if (!existing)
    throw new NotFound("That contribution was not found in this club.");

  if (
    toCents(existing.written_off_amount || "0") > 0 ||
    ["Exited", "Expelled"].includes(existing.standing)
  )
    throw new RuleRefusal(
      "This membership has ended or its contribution was written off. No new cash can be captured against it.",
    );

  // REQ-59.
  if (existing.cycle_status === "Closed" && !input.correctsEntryId) {
    throw new RuleRefusal(
      `Cycle ${existing.sequence_number} is closed. A correction to a closed cycle needs a ` +
        `reversing entry followed by a fresh capture, so that the original record survives.`,
      { requirement: "REQ-59" },
    );
  }

  const constitution = await repo.constitutionForCycle(db, existing.cycle_id);
  const graceDays = constitution?.grace_period_days || 0;
  const penaltyCents = toCents(constitution?.penalty_amount || 0);

  const amountCents = toCents(input.amount);
  const expectedCents = toCents(existing.expected_amount);
  const alreadyCents = toCents(existing.captured_amount);

  // The amount that answers THIS cycle, and the amount that overflows it.
  const shortfallCents = Math.max(0, expectedCents - alreadyCents);
  const appliedCents = Math.min(amountCents, shortfallCents);
  const excessCents = amountCents - appliedCents;

  const receiptDate = input.receiptDate
    ? inputDate(input.receiptDate, "Receipt date")
    : todayIso();

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
    graceDays,
  });

  const result = await withClubTransaction(db.clubId, async (tx, client) => {
    await repo.lockClub(tx);
    const isCorrection = await compensation.correction(tx, contributionId, input.correctsEntryId);
    const live = await repo.getContribution(tx, contributionId);
    if (
      toCents(live.written_off_amount || "0") > 0 ||
      ["Exited", "Expelled"].includes(live.standing) ||
      (live.cycle_status === "Closed" && !isCorrection) ||
      live.expected_amount !== existing.expected_amount ||
      live.captured_amount !== existing.captured_amount
    )
      throw new RuleRefusal(
        "The contribution or membership changed. Reload before capturing payment.",
      );
    // Assess before allocating excess, so this receipt can settle today's penalty.
    const penalty = penaltyIsDue(statusBefore)
      ? await levyLatePenalty(tx, existing, toNumeric(penaltyCents), actor) : null;
    const newCapturedCents = alreadyCents + appliedCents;

    const status = resolveStatus({
      expected: existing.expected_amount,
      captured: toNumeric(newCapturedCents),
      dueDate: existing.due_date,
      graceDays,
    });

    await repo.applyCapture(tx, contributionId, {
      capturedAmount: toNumeric(newCapturedCents),
      status,
      receiptDate,
      method: input.method,
      reference: input.reference || null,
      capturedBy: actor.userId,
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
      postedBy: actor.userId,
    });

    // REQ-57.
    let excess = { allocations: [], creditCents: 0 };
    if (excessCents > 0) {
      excess = await applyExcess(tx, {
        memberId: existing.member_id,
        excessCents,
        excludeContributionId: contributionId,
      });
    }

    await compensation.recordReceipt(tx, entry.entryId, contributionId, {...input, receiptDate}, [
      {type: "contribution", id: contributionId, amount: toNumeric(appliedCents)}, ...excess.allocations,
    ]);


    return { status, newCapturedCents, entry, excess, penalty };
  });

  await audit("contribution.capture", "Success", {
    detail:
      `${actor.fullName} captured ${format(amountCents)} from ${existing.full_name} ` +
      `for cycle ${existing.sequence_number} (${input.method}). Status: ${result.status}.` +
      (excessCents > 0 ? ` Excess ${format(excessCents)} reallocated.` : "") +
      (result.penalty ? ` Late penalty ${format(penaltyCents)} levied.` : ""),
    targetType: "contribution",
    targetId: contributionId,
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
      resultingBalance: result.entry.resultingBalance,
    },
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
    capturedTotal: c.captured_total,
  }));
}

async function getCycleDetail(db, cycleId) {
  const cycle = cycleId
    ? await repo.getCycle(db, cycleId)
    : await repo.openCycleFor(db);

  if (!cycle) return null;

  const constitution = await repo.constitutionForCycle(db, cycle.cycle_id);
  const graceDays = constitution?.grace_period_days || 0;
  const rows = await repo.listForCycle(db, cycle.cycle_id);

  return {
    cycle: {
      cycleId: cycle.cycle_id,
      sequenceNumber: cycle.sequence_number,
      startDate: cycle.start_date,
      dueDate: cycle.due_date,
      status: cycle.status,
      lateFrom: addDays(cycle.due_date, Number(graceDays) + 1),
      gracePeriodDays: graceDays,
      penaltyAmount: constitution?.penalty_amount || "0.00",
    },
    contributions: await Promise.all(rows.map(async (r) => ({
      correctionCandidates: await compensation.correctionCandidates(db, r.contribution_id),
      contributionId: r.contribution_id,
      memberId: r.member_id,
      fullName: r.full_name,
      phone: r.phone,
      standing: r.standing,
      expected: r.expected_amount,
      captured: r.captured_amount,
      writtenOff: r.written_off_amount || "0.00",
      // Recomputed on read, so a status does not go stale merely because
      // nobody has touched the record since the deadline passed (REQ-54).
      status:
        toCents(r.written_off_amount || "0") > 0
          ? "Written off"
          : resolveStatus({
              expected: r.expected_amount,
              captured: r.captured_amount,
              dueDate: cycle.due_date,
              graceDays,
            }),
      storedStatus: r.status,
      receiptDate: r.receipt_date,
      method: r.method,
      reference: r.reference,
    }))),
  };
}

// ---------------------------------------------------------------------------
// waivePenalty()  REQ-63, BR-13
// ---------------------------------------------------------------------------

/**
 * Waives a penalty. The Chairperson-only permission is enforced by the route
 * (penalty.waive); this function trusts that it has already been checked, the
 * same way every other service in this codebase trusts its route.
 *
 * The penalty is never deleted and its amount is never edited (REQ-90's own
 * rule, extended here to the penalty record itself, migration 014). Instead:
 * the original 'Penalty' ledger entry is reversed with an opposing entry
 * (REQ-63's own wording — "a reversing entry rather than by deleting the
 * original penalty"), and the penalty row is marked waived, with the reason,
 * once, permanently (the database enforces this even bypassing the service).
 */
const OFFICERS = ["Treasurer", "Secretary", "Chairperson"];
async function listPenalties(db, query, { actor }) {
  const status = query.status || "all";
  const offset = Number(query.offset || 0);
  if (
    !["all", "outstanding", "settled", "waived"].includes(status) ||
    !Number.isSafeInteger(offset) ||
    offset < 0
  )
    throw new BadRequest("Choose a valid penalty filter and page.");
  const rows = await repo.listPenalties(db, {
    memberId: OFFICERS.includes(actor.role) ? null : actor.memberId,
    status,
    offset,
    limit: 51,
  });
  return {
    hasMore: rows.length > 50,
    penalties: rows.slice(0, 50).map((p) => ({
      penaltyId: p.penalty_id,
      fullName: p.full_name,
      memberId: p.member_id,
      cycleNumber: p.sequence_number,
      amount: p.amount,
      settledAmount: p.settled_amount,
      outstandingAmount: p.waived_at
        ? "0.00"
        : toNumeric(toCents(p.amount) - toCents(p.settled_amount)),
      reason: p.reason,
      leviedAt: p.levied_at,
      status: p.waived_at
        ? "Waived"
        : toCents(p.settled_amount) >= toCents(p.amount)
          ? "Settled"
          : "Outstanding",
      waivedAt: p.waived_at,
      waivedBy: p.waived_by_name,
      waiverReason: p.waiver_reason,
    })),
  };
}

async function waivePenalty(db, penaltyId, { reason }, { actor, audit }) {
  const outcome = await withClubTransaction(db.clubId, async (tx, client) => {
    await repo.lockClub(tx);
    const penalty = await repo.getPenalty(tx, penaltyId);
    if (!penalty) return { notFound: true };

    const assessment = assessWaiver({
      alreadyWaived: !!penalty.waived_at,
      reason,
    });
    if (!assessment.eligible) {
      return {
        refused: assessment.refusals.map((r) => r.message).join(" "),
        detail: { refusals: assessment.refusals },
        penalty,
      };
    }

    const original = await repo.getPenaltyLedgerEntry(tx, penaltyId);
    if (!original) {
      // Defensive: every levied penalty posts its own entry (see the
      // comment in captureContribution). Nothing in this codebase can
      // reach this branch, but a silent no-op would be worse than a
      // clear error if it ever did.
      return {
        refused:
          "No ledger entry was found for this penalty. It cannot be waived without one to reverse.",
        detail: {},
      };
    }

    const entry = await ledger.appendEntry(client, {
      clubId: tx.clubId,
      memberId: penalty.member_id,
      entryType: "Reversal",
      amount: toNumeric(-toCents(original.amount)),
      description: `Waived penalty${penalty.sequence_number ? `, cycle ${penalty.sequence_number}` : ""} — ${penalty.full_name}: ${String(reason).trim()}`,
      reversesId: original.entry_id,
      reason: String(reason).trim(),
      penaltyId,
      postedBy: actor.userId,
    });

    await repo.markWaived(tx, penaltyId, {
      waivedBy: actor.userId,
      reason: String(reason).trim(),
    });
    return { penalty, entry };
  });

  if (outcome.notFound)
    throw new NotFound("That penalty was not found in this club.");
  if (outcome.refused) {
    await audit("penalty.waive", "Refused", {
      detail: `Refused: ${outcome.refused}`,
      targetType: "penalty",
      targetId: penaltyId,
    });
    throw new RuleRefusal(outcome.refused, outcome.detail);
  }

  await audit("penalty.waive", "Success", {
    detail:
      `${actor.fullName} waived the penalty of ${format(toCents(outcome.penalty.amount))} against ` +
      `${outcome.penalty.full_name}. Reason: ${String(reason).trim()}. Pool balance now ${format(toCents(outcome.entry.resultingBalance))}.`,
    targetType: "penalty",
    targetId: penaltyId,
  });

  return {
    penaltyId,
    waivedAt: new Date().toISOString(),
    waivedBy: actor.fullName,
    reason: String(reason).trim(),
    reversingEntryId: outcome.entry.entryId,
    resultingBalance: outcome.entry.resultingBalance,
  };
}

// ---------------------------------------------------------------------------
// Proof of payment. REQ-51 to REQ-53.
// ---------------------------------------------------------------------------

const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"];
const MAX_FILE_SIZE = 5 * 1024 * 1024; // REQ-53: 5 MB

/**
 * @param {object} file  { buffer, mimetype, originalname, size } — multer's shape,
 *                       passed through rather than re-declared to avoid a second
 *                       definition of what a file upload looks like.
 */
async function uploadProof(db, contributionId, file, { actor, audit }) {
  const contribution = await repo.getContribution(db, contributionId);
  if (!contribution)
    throw new NotFound("That contribution was not found in this club.");

  if (toCents(contribution.captured_amount) <= 0)
    throw new RuleRefusal(
      "Capture a contribution before attaching proof of payment (REQ-53).",
    );
  if (!file || !file.size) throw new BadRequest("Attach a non-empty file.");
  if (!ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    throw new BadRequest("Only JPEG, PNG or PDF files are accepted (REQ-53).");
  }
  if (file.size > MAX_FILE_SIZE) {
    throw new BadRequest(
      `That file is too large. The limit is 5 MB (REQ-53); this one is ${(file.size / (1024 * 1024)).toFixed(1)} MB.`,
    );
  }

  const b = file.buffer;
  const signature =
    file.mimetype === "application/pdf"
      ? b.subarray(0, 5).toString() === "%PDF-"
      : file.mimetype === "image/png"
        ? b
            .subarray(0, 8)
            .equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
        : b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255;
  if (!signature)
    throw new BadRequest(
      "The file contents do not match its JPEG, PNG or PDF type.",
    );
  const saved = await withClubTransaction(db.clubId, (tx) =>
    repo.upsertProof(tx, contributionId, {
      fileData: file.buffer,
      mimeType: file.mimetype,
      originalFilename: file.originalname.slice(0, 255),
      fileSize: file.size,
      uploadedBy: actor.userId,
    }),
  );

  await audit("contribution.uploadProof", "Success", {
    detail: `${actor.fullName} attached ${saved.original_filename} (${(saved.file_size / 1024).toFixed(0)} KB) as proof of payment for ${contribution.full_name}'s contribution.`,
    targetType: "contribution",
    targetId: contributionId,
  });

  return {
    proofId: saved.proof_id,
    filename: saved.original_filename,
    mimeType: saved.mime_type,
    fileSize: saved.file_size,
    uploadedAt: saved.uploaded_at,
  };
}

async function assertProofAccess(db, contributionId, actor) {
  const contribution = await repo.getContribution(db, contributionId);
  if (
    !contribution ||
    (!OFFICERS.includes(actor?.role) &&
      contribution.member_id !== actor?.memberId)
  ) {
    throw new NotFound(
      "That contribution was not found in your accessible records.",
    );
  }
}

async function getProofMeta(db, contributionId, { actor }) {
  await assertProofAccess(db, contributionId, actor);
  const meta = await repo.getProofMeta(db, contributionId);
  if (!meta) return null;
  return {
    proofId: meta.proof_id,
    filename: meta.original_filename,
    mimeType: meta.mime_type,
    fileSize: meta.file_size,
    uploadedAt: meta.uploaded_at,
  };
}

/** The raw bytes for a download response. Route sets the content type and disposition. */
async function downloadProof(db, contributionId, { actor }) {
  await assertProofAccess(db, contributionId, actor);
  const file = await repo.getProofFile(db, contributionId);
  if (!file)
    throw new NotFound(
      "No proof of payment has been uploaded for this contribution.",
    );
  return file;
}

async function deleteProof(db, contributionId, { actor, audit }) {
  const meta = await repo.getProofMeta(db, contributionId);
  if (!meta)
    throw new NotFound(
      "No proof of payment has been uploaded for this contribution.",
    );
  await withClubTransaction(db.clubId, (tx) =>
    repo.deleteProof(tx, contributionId),
  );
  await audit("contribution.deleteProof", "Success", {
    detail: `${actor.fullName} removed the proof of payment (${meta.original_filename}).`,
    targetType: "contribution",
    targetId: contributionId,
  });
  return { deleted: true };
}

module.exports = {
  openCycle,
  closeCycle,
  captureContribution,
  applyExcess,
  listCycles,
  getCycleDetail,
  listPenalties,
  waivePenalty,
  uploadProof,
  getProofMeta,
  downloadProof,
  deleteProof,
};
