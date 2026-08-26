/**
 * Rules engine.
 *
 * These are pure functions. They import no React, touch no store and know nothing
 * about the interface. They take a constitution plus a transaction context and
 * return a ruling. This satisfies SRS 5.4 (Testability) and 6.4 (Reuse): the
 * engine can be exercised exhaustively without traversing screens, and it survives
 * unchanged into the production system.
 *
 * Every refusal the prototype shows comes from here. None of it is scripted.
 */

import { addDays, daysBetween } from "@/lib/format";

// --- REQ-54, REQ-55: contribution status resolution -------------------------
export function resolveContributionStatus({ expected, captured, dueDate, graceDays, asAt = new Date() }) {
  if (captured >= expected) return "Paid";
  const graceEnds = addDays(dueDate, graceDays);
  if (asAt > graceEnds) return "Late";
  if (captured > 0) return "Partial";
  return "Outstanding";
}

// --- REQ-57: excess cascades to penalties, then oldest arrears, then credit --
export function allocateExcess({ excess, outstandingPenalties = [], arrears = [] }) {
  let remaining = Number(excess);
  const allocations = [];
  for (const p of outstandingPenalties) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, p.amount);
    allocations.push({ target: "penalty", id: p.id, amount: applied, label: p.label });
    remaining -= applied;
  }
  const byAge = [...arrears].sort((a, b) => new Date(a.dueDate) - new Date(b.dueDate));
  for (const a of byAge) {
    if (remaining <= 0) break;
    const applied = Math.min(remaining, a.outstanding);
    allocations.push({ target: "arrear", id: a.id, amount: applied, label: a.label });
    remaining -= applied;
  }
  if (remaining > 0) allocations.push({ target: "credit", id: null, amount: remaining, label: "Credit against next cycle" });
  return allocations;
}

// --- REQ-64 / BR-2: dual authorisation ---------------------------------------
export function canApprovePayout({ payout, actor }) {
  if (payout.status !== "Initiated")
    return { allowed: false, code: "NOT_PENDING", reason: `This payout is already ${payout.status.toLowerCase()}.` };
  if (actor.role !== "Chairperson")
    return { allowed: false, code: "ROLE", reason: "Only the Chairperson may approve a payout." };
  if (payout.initiatedBy === actor.userId)
    return {
      allowed: false, code: "SAME_ACCOUNT",
      reason: "You initiated this payout. A payout must be approved by a different officer (REQ-64)."
    };
  return { allowed: true };
}

// --- REQ-66, REQ-67, REQ-72, REQ-77: rotating payout eligibility -------------
export function assessRotatingPayout({ members, targetMemberId, poolBalance, constitution }) {
  const eligible = members.filter((m) => m.standing !== "Exited" && m.standing !== "Expelled");
  const queue = [...eligible].sort((a, b) => a.queuePosition - b.queuePosition);
  const head = queue[0];
  const target = members.find((m) => m.id === targetMemberId);
  const amount = constitution.contributionAmount * eligible.length;
  const checks = [];

  if (!target) return { eligible: false, checks, refusal: { code: "NOT_FOUND", message: "Member not found." } };

  // REQ-72 / BR-4
  const isHead = head && head.id === target.id;
  checks.push({
    id: "queue", label: "Position in payout queue", pass: isHead,
    detail: isHead
      ? `${target.fullName} is at the head of the queue (position ${target.queuePosition}).`
      : `${target.fullName} is at position ${target.queuePosition}. ${head.fullName} is next.`
  });

  // REQ-67 / BR-5
  const standingOk = target.standing === "Good standing";
  checks.push({
    id: "standing", label: "Member standing", pass: standingOk,
    detail: standingOk ? "Member is in good standing." : `Member standing is “${target.standing}”.`,
    fork: !standingOk && isHead
  });

  // REQ-66
  const fundsOk = poolBalance >= amount;
  checks.push({
    id: "funds", label: "Pool sufficiency", pass: fundsOk,
    detail: fundsOk ? "Pool balance covers the payout in full."
      : `Pool is short by R${(amount - poolBalance).toFixed(2)}.`
  });

  const failed = checks.find((c) => !c.pass);
  return {
    eligible: !failed,
    amount,
    checks,
    head,
    resultingBalance: poolBalance - amount,
    ruleApplied: `Rotation, ${constitution.payoutOrderMethod.toLowerCase()} order, constitution v${constitution.version}`,
    refusal: failed && {
      code: failed.id.toUpperCase(),
      message: failed.detail,
      // REQ-77: arrears at the head of the queue is a decision for the Chairperson,
      // not a dead end.
      fork: failed.fork
        ? { options: ["Defer to end of queue", "Resolve to pay notwithstanding arrears"] }
        : null
    }
  };
}

// --- REQ-84..REQ-88: burial claim assessment ---------------------------------
export function assessBurialClaim({ member, dependant, dateOfDeath, constitution, poolBalance }) {
  const checks = [];

  const standingOk = member.standing === "Good standing"; // REQ-84
  checks.push({
    id: "standing", label: "Claimant standing", pass: standingOk,
    detail: standingOk ? "Claimant is in good standing on the date of the claim."
      : `Claimant standing is “${member.standing}”. A claim may not be assessed while a member is in arrears.`
  });

  const covered = !!dependant && dependant.memberId === member.id; // REQ-85
  checks.push({
    id: "cover", label: "Recorded covered dependant", pass: covered,
    detail: covered ? `${dependant.name} is recorded as a covered dependant (${dependant.category}).`
      : "The deceased is not recorded as a covered dependant of the claimant."
  });

  const waited = daysBetween(member.joinDate, dateOfDeath) >= constitution.waitingPeriodDays; // REQ-87
  checks.push({
    id: "waiting", label: `Waiting period (${constitution.waitingPeriodDays} days)`, pass: waited,
    detail: waited
      ? `Member joined ${daysBetween(member.joinDate, dateOfDeath)} days before the date of death.`
      : `Only ${Math.max(0, daysBetween(member.joinDate, dateOfDeath))} of ${constitution.waitingPeriodDays} days elapsed.`
  });

  const tier = covered ? constitution.benefitSchedule.find((b) => b.category === dependant.category) : null; // REQ-86
  const amount = tier ? tier.amount : 0;

  // REQ-88 / BR-12: no part payment.
  const fundsOk = poolBalance >= amount;
  checks.push({
    id: "funds", label: "Pool sufficiency", pass: fundsOk,
    detail: fundsOk ? "Pool balance covers the benefit in full."
      : `Pool is short by R${(amount - poolBalance).toFixed(2)}. No part payment may be made; the shortfall goes to the Chairperson.`
  });

  const failed = checks.find((c) => !c.pass);
  return {
    eligible: !failed, amount, tier, checks,
    resultingBalance: poolBalance - amount,
    ruleApplied: tier
      ? `Burial benefit, ${tier.category} tier, constitution v${constitution.version} in force on ${new Date(dateOfDeath).toDateString()}`
      : "No benefit tier determined",
    refusal: failed && { code: failed.id.toUpperCase(), message: failed.detail }
  };
}

// --- REQ-29: constitution internal consistency -------------------------------
export function validateConstitution(c, cycleLengthDays = 30) {
  const errors = [];
  if (!(c.contributionAmount > 0)) errors.push("Contribution amount must be greater than zero.");
  if (c.gracePeriodDays >= cycleLengthDays) errors.push("Grace period may not equal or exceed the cycle length.");
  if (c.quorumPercentage < 1 || c.quorumPercentage > 100) errors.push("Quorum must fall between 1 and 100 per cent.");
  return { valid: errors.length === 0, errors };
}

// --- REQ-106: quorum ---------------------------------------------------------
export function quorumMet({ present, activeMembers, quorumPercentage }) {
  const required = Math.ceil((quorumPercentage / 100) * activeMembers);
  return { met: present >= required, required, present };
}

// --- REQ-78: projected payout date ------------------------------------------
export function projectedPayoutDate({ queuePosition, cycleStart, frequency }) {
  const step = frequency === "Weekly" ? 7 : frequency === "Fortnightly" ? 14 : 30;
  return addDays(cycleStart, step * Math.max(0, queuePosition - 1));
}
