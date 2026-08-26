"use client";

/**
 * DATA ACCESS BOUNDARY.
 *
 * Components never reach into the store directly. They call the selectors below.
 * Today those selectors read an in-memory object. In production the same function
 * signatures are backed by PostgreSQL queries, and nothing above this line changes.
 *
 * Every selector takes clubId as its first argument and filters on it. That is the
 * prototype's stand-in for the tenancy filter described in SDD 4.1 (REQ-13). In
 * production the filter is middleware wrapping the data-access layer so that no
 * query can be written that forgets it.
 */

import { useEffect, useState } from "react";
import { useStore } from "@/lib/store";
import { can } from "@/lib/rules/permissions";
import { projectedPayoutDate } from "@/lib/rules";

const r2 = (n) => Math.round(n * 100) / 100;

// --- Session -----------------------------------------------------------------
export function useSession() {
  const { state, dispatch } = useStore();
  const { userId, clubId } = state.session;
  const user = state.users.find((u) => u.id === userId) || null;
  const club = state.clubs.find((c) => c.id === clubId) || null;
  const membership = state.members.find((m) => m.userId === userId && m.clubId === clubId) || null;
  const role = user?.isPlatformAdmin ? "PlatformAdmin" : membership?.role || null;

  return {
    user, club, membership, role, userId, clubId,
    isPlatformAdmin: !!user?.isPlatformAdmin,
    can: (action) => can(role, action),
    memberships: state.members.filter((m) => m.userId === userId),
    signIn: (id) => dispatch({ type: "SET_SESSION", payload: { userId: id, clubId: null } }),
    selectClub: (id) => dispatch({ type: "SET_SESSION", payload: { clubId: id } }),
    signOut: () => dispatch({ type: "SIGN_OUT" }),
    dispatch
  };
}

// --- Simulated fetch ---------------------------------------------------------
// PROTOTYPE ONLY. A short delay so loading and skeleton states are exercised
// honestly rather than decoratively. Set to 0 from the demo controls before a
// live presentation.
export function useQuery(compute, deps = [], { latency } = {}) {
  const { state } = useStore();
  const delay = latency ?? state.meta.latency ?? 240;
  const [result, setResult] = useState({ data: null, loading: true });

  useEffect(() => {
    let alive = true;
    if (delay === 0) { setResult({ data: compute(), loading: false }); return; }
    setResult((r) => ({ ...r, loading: true }));
    const t = setTimeout(() => { if (alive) setResult({ data: compute(), loading: false }); }, delay);
    return () => { alive = false; clearTimeout(t); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, delay, state]);

  return result;
}

// --- Selectors ---------------------------------------------------------------
export function useData() {
  const { state } = useStore();

  const ledgerFor = (clubId) => state.ledger.filter((e) => e.clubId === clubId);
  const poolBalance = (clubId) => r2(ledgerFor(clubId).reduce((a, e) => a + e.amount, 0));
  const membersFor = (clubId) => state.members.filter((m) => m.clubId === clubId);
  const activeMembers = (clubId) => membersFor(clubId).filter((m) => m.standing !== "Exited" && m.standing !== "Expelled");
  const constitutionFor = (clubId) => {
    const club = state.clubs.find((c) => c.id === clubId);
    return state.constitutions.find((c) => c.id === club?.constitutionId);
  };
  const cyclesFor = (clubId) => state.cycles.filter((c) => c.clubId === clubId).sort((a, b) => b.sequenceNumber - a.sequenceNumber);
  const openCycle = (clubId) => cyclesFor(clubId).find((c) => c.status === "Open");
  const contributionsFor = (clubId, cycleId) =>
    state.contributions.filter((c) => c.clubId === clubId && (!cycleId || c.cycleId === cycleId));

  const queueFor = (clubId) =>
    activeMembers(clubId)
      .filter((m) => m.queuePosition != null)
      .sort((a, b) => a.queuePosition - b.queuePosition);

  const memberBalance = (clubId, memberId) => {
    const entries = ledgerFor(clubId).filter((e) => e.memberId === memberId);
    const paid = entries.filter((e) => e.type === "Contribution").reduce((a, e) => a + e.amount, 0);
    const penalties = entries.filter((e) => e.type === "Penalty").reduce((a, e) => a + e.amount, 0);
    const reversed = entries.filter((e) => e.type === "Reversal").reduce((a, e) => a + e.amount, 0);
    const received = entries.filter((e) => e.type === "Payout").reduce((a, e) => a + Math.abs(e.amount), 0);
    const outstanding = contributionsFor(clubId)
      .filter((c) => c.memberId === memberId)
      .reduce((a, c) => a + Math.max(0, c.expectedAmount - c.capturedAmount), 0);
    return { paid: r2(paid), penalties: r2(penalties + reversed), received: r2(received), outstanding: r2(outstanding) };
  };

  const memberStatement = (clubId, memberId) =>
    ledgerFor(clubId)
      .filter((e) => e.memberId === memberId)
      .sort((a, b) => new Date(a.postedAt) - new Date(b.postedAt))
      .reduce((acc, e) => {
        const prev = acc.length ? acc[acc.length - 1].running : 0;
        const delta = e.type === "Payout" ? 0 : e.amount;
        acc.push({ ...e, running: r2(prev + delta) });
        return acc;
      }, []);

  const outstandingTotal = (clubId) =>
    r2(contributionsFor(clubId).reduce((a, c) => a + Math.max(0, c.expectedAmount - c.capturedAmount), 0));

  const monthlySeries = (clubId, months = 12) => {
    const now = new Date();
    const out = [];
    for (let i = months - 1; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
      const next = new Date(d.getFullYear(), d.getMonth() + 1, 1);
      const inWindow = ledgerFor(clubId).filter((e) => {
        const t = new Date(e.postedAt);
        return t >= d && t < next;
      });
      out.push({
        label: d,
        income: r2(inWindow.filter((e) => e.amount > 0).reduce((a, e) => a + e.amount, 0)),
        expenditure: r2(Math.abs(inWindow.filter((e) => e.amount < 0).reduce((a, e) => a + e.amount, 0)))
      });
    }
    return out;
  };

  const latestReconciliation = (clubId) =>
    state.reconciliations.filter((r) => r.clubId === clubId)
      .sort((a, b) => new Date(b.asAtDate) - new Date(a.asAtDate))[0] || null;

  const pendingPayouts = (clubId) => state.payouts.filter((p) => p.clubId === clubId && p.status === "Initiated");
  const payoutsFor = (clubId) => state.payouts.filter((p) => p.clubId === clubId)
    .sort((a, b) => new Date(b.initiatedAt) - new Date(a.initiatedAt));
  const claimsFor = (clubId) => state.claims.filter((c) => c.clubId === clubId)
    .sort((a, b) => new Date(b.lodgedAt) - new Date(a.lodgedAt));
  const announcementsFor = (clubId) => state.announcements.filter((a) => a.clubId === clubId)
    .sort((a, b) => new Date(b.publishedAt) - new Date(a.publishedAt));
  const notificationsFor = (clubId) => state.notifications.filter((n) => n.clubId === clubId);

  const projectedDate = (clubId, member) => {
    const con = constitutionFor(clubId);
    if (!con || member.queuePosition == null) return null;
    return projectedPayoutDate({
      queuePosition: member.queuePosition,
      cycleStart: openCycle(clubId)?.startDate || new Date(),
      frequency: con.cycleFrequency
    });
  };

  // REQ-20 / REQ-114: platform aggregate only. No club or member detail.
  const platformAggregate = () => ({
    clubs: state.clubs.length,
    activeClubs: state.clubs.filter((c) => c.status === "Active").length,
    members: state.members.filter((m) => m.standing !== "Exited").length,
    fundsUnderAdministration: r2(state.clubs.reduce((a, c) => a + poolBalance(c.id), 0))
  });

  return {
    state, ledgerFor, poolBalance, membersFor, activeMembers, constitutionFor,
    cyclesFor, openCycle, contributionsFor, queueFor, memberBalance, memberStatement,
    outstandingTotal, monthlySeries, latestReconciliation, pendingPayouts, payoutsFor,
    claimsFor, announcementsFor, notificationsFor, projectedDate, platformAggregate,
    userName: (id) => state.users.find((u) => u.id === id)?.fullName
      || state.members.find((m) => m.userId === id)?.fullName
      || (id === "system" ? "System (automatic)" : "—")
  };
}
