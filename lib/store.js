"use client";

/**
 * Prototype state container.
 *
 * PROTOTYPE ONLY. This is an in-memory store persisted to localStorage so a demo
 * survives a refresh. It is not a database and makes no durability, concurrency or
 * integrity guarantee. In production every read and write below moves behind the
 * data-access boundary in lib/data.js and is served by PostgreSQL inside explicit
 * transactions.
 *
 * The append-only property of the ledger (BR-3, REQ-90) is honoured here by
 * convention: no action in this reducer mutates or removes an existing ledger
 * entry. Corrections append a reversal. In production the same property is
 * enforced by a database-level rule so that it does not rest on application code.
 */

import React, { createContext, useContext, useEffect, useMemo, useReducer, useRef } from "react";
import { buildSeed, recalcBalances } from "@/lib/mock/seed";

const KEY = "stokvel-prototype-state-v1";
const StoreCtx = createContext(null);

function seedWithExceptions() {
  const s = buildSeed();
  // Seed a live reconciliation exception on Mmakau so the Treasurer dashboard has
  // something that requires attention on the very first screen of the demo.
  const derived = s.ledger.filter((e) => e.clubId === "club-mmakau").reduce((a, e) => a + e.amount, 0);
  s.reconciliations = [
    {
      id: "rec-001", clubId: "club-mmakau",
      asAtDate: new Date(Date.now() - 3 * 86400000).toISOString(),
      derivedBalance: round(derived), bankBalance: round(derived - 450),
      difference: -450, status: "Exception", recordedBy: "u-nomsa",
      note: null
    }
  ];
  return s;
}

function round(n) { return Math.round(n * 100) / 100; }
const nid = (p) => `${p}-${Math.random().toString(36).slice(2, 8)}`;

function reducer(state, action) {
  switch (action.type) {
    case "__HYDRATE__":
      return action.payload;

    case "RESET":
      return seedWithExceptions();

    case "SET_SESSION":
      return { ...state, session: { ...state.session, ...action.payload } };

    case "SIGN_OUT":
      return { ...state, session: { userId: null, clubId: null, actingRole: null } };

    // REQ-51 / REQ-54 / REQ-89: capture writes the contribution and its ledger
    // entry together. In production this is one database transaction.
    case "CAPTURE_CONTRIBUTION": {
      const { contributionId, amount, receiptDate, method, reference, actorId, status, proofOfPayment } = action.payload;
      const contributions = state.contributions.map((c) =>
        c.id === contributionId
          ? { ...c, capturedAmount: round(c.capturedAmount + amount), receiptDate, method, reference, status, capturedBy: actorId, proofOfPayment: proofOfPayment || c.proofOfPayment }
          : c
      );
      const target = state.contributions.find((c) => c.id === contributionId);
      const cycle = state.cycles.find((c) => c.id === target.cycleId);
      const ledger = recalcBalances([
        ...state.ledger,
        {
          id: nid("led"), clubId: target.clubId, memberId: target.memberId,
          type: "Contribution", amount, postedAt: new Date(receiptDate).toISOString(),
          postedBy: actorId, description: `Contribution — cycle ${cycle.sequenceNumber}`,
          reversesId: null, reason: null, resultingBalance: 0
        }
      ]);
      return { ...state, contributions, ledger };
    }

    // REQ-64: initiation. Nothing is posted to the ledger yet.
    case "INITIATE_PAYOUT": {
      const p = { id: nid("pay"), status: "Initiated", initiatedAt: new Date().toISOString(), ...action.payload };
      return { ...state, payouts: [...state.payouts, p] };
    }

    case "CANCEL_PAYOUT":
      return {
        ...state,
        payouts: state.payouts.map((p) =>
          p.id === action.payload.id
            ? { ...p, status: "Cancelled", cancelledAt: new Date().toISOString(), cancelReason: action.payload.reason }
            : p
        )
      };

    // REQ-64 / REQ-73: approval posts the payout and advances the queue.
    case "APPROVE_PAYOUT": {
      const { id, actorId } = action.payload;
      const payout = state.payouts.find((p) => p.id === id);
      const payouts = state.payouts.map((p) =>
        p.id === id ? { ...p, status: "Approved", approvedBy: actorId, approvedAt: new Date().toISOString() } : p
      );
      const ledger = recalcBalances([
        ...state.ledger,
        {
          id: nid("led"), clubId: payout.clubId, memberId: payout.memberId,
          type: "Payout", amount: -Math.abs(payout.amount), postedAt: new Date().toISOString(),
          postedBy: actorId, description: payout.description, reversesId: null, reason: null, resultingBalance: 0
        }
      ]);
      let members = state.members;
      if (payout.payoutType === "Rotation") {
        const club = state.members.filter((m) => m.clubId === payout.clubId && m.queuePosition != null && m.standing !== "Exited");
        const max = Math.max(...club.map((m) => m.queuePosition));
        members = state.members.map((m) => {
          if (m.clubId !== payout.clubId || m.queuePosition == null) return m;
          if (m.id === payout.memberId) return { ...m, queuePosition: max };
          return m.queuePosition > 1 ? { ...m, queuePosition: m.queuePosition - 1 } : m;
        });
      }
      const claims = payout.claimId
        ? state.claims.map((c) => (c.id === payout.claimId ? { ...c, status: "Paid" } : c))
        : state.claims;
      return { ...state, payouts, ledger, members, claims };
    }

    // REQ-91 / BR-3: correction by reversal. The original is untouched.
    case "POST_REVERSAL": {
      const original = state.ledger.find((e) => e.id === action.payload.entryId);
      const ledger = recalcBalances([
        ...state.ledger,
        {
          id: nid("led"), clubId: original.clubId, memberId: original.memberId,
          type: "Reversal", amount: -original.amount, postedAt: new Date().toISOString(),
          postedBy: action.payload.actorId,
          description: `Reversal of ${original.id}`,
          reversesId: original.id, reason: action.payload.reason, resultingBalance: 0
        }
      ]);
      return { ...state, ledger };
    }

    // REQ-96 / REQ-97 / REQ-98
    case "RECORD_BANK_BALANCE": {
      const { clubId, bankBalance, asAtDate, actorId, note } = action.payload;
      const derived = state.ledger.filter((e) => e.clubId === clubId).reduce((a, e) => a + e.amount, 0);
      const difference = round(bankBalance - derived);
      const rec = {
        id: nid("rec"), clubId, asAtDate, bankBalance: round(bankBalance),
        derivedBalance: round(derived), difference,
        status: difference === 0 ? "Clean" : "Exception", recordedBy: actorId, note: note || null
      };
      return { ...state, reconciliations: [rec, ...state.reconciliations] };
    }

    // REQ-98: an explanatory entry is the only way a difference is cleared.
    case "EXPLAIN_DIFFERENCE": {
      const { clubId, amount, reason, actorId } = action.payload;
      const ledger = recalcBalances([
        ...state.ledger,
        {
          id: nid("led"), clubId, memberId: null, type: "Adjustment", amount,
          postedAt: new Date().toISOString(), postedBy: actorId,
          description: "Explanatory reconciliation entry", reversesId: null,
          reason, resultingBalance: 0
        }
      ]);
      const derived = ledger.filter((e) => e.clubId === clubId).reduce((a, e) => a + e.amount, 0);
      const last = state.reconciliations.find((r) => r.clubId === clubId);
      const rec = last
        ? { ...last, id: nid("rec"), derivedBalance: round(derived), difference: round(last.bankBalance - derived), status: round(last.bankBalance - derived) === 0 ? "Clean" : "Exception", note: reason, asAtDate: new Date().toISOString() }
        : null;
      return { ...state, ledger, reconciliations: rec ? [rec, ...state.reconciliations] : state.reconciliations };
    }

    case "ASSESS_CLAIM":
      return {
        ...state,
        claims: state.claims.map((c) =>
          c.id === action.payload.id
            ? { ...c, status: action.payload.status, assessedAt: new Date().toISOString(), assessedBy: action.payload.actorId, refusalReason: action.payload.refusalReason || null }
            : c
        )
      };

    // REQ-43: registration by Secretary or Chairperson only (enforced at the call site).
    case "REGISTER_MEMBER": {
      const m = action.payload;
      const clubMembers = state.members.filter((x) => x.clubId === m.clubId && x.queuePosition != null);
      const queuePosition = clubMembers.length ? Math.max(...clubMembers.map((x) => x.queuePosition)) + 1 : null;
      return {
        ...state,
        members: [...state.members, { ...m, id: nid("mem"), queuePosition: m.usesQueue ? queuePosition : null, standing: "Good standing", beneficiaries: [], dependants: [], exitDate: null }]
      };
    }

    case "WAIVE_PENALTY": {
      const entry = state.ledger.find((e) => e.id === action.payload.entryId);
      const ledger = recalcBalances([
        ...state.ledger,
        {
          id: nid("led"), clubId: entry.clubId, memberId: entry.memberId,
          type: "Reversal", amount: -entry.amount, postedAt: new Date().toISOString(),
          postedBy: action.payload.actorId, description: `Reversal of penalty ${entry.id}`,
          reversesId: entry.id, reason: action.payload.reason, resultingBalance: 0
        }
      ]);
      return { ...state, ledger };
    }

    case "SET_LATENCY":
      return { ...state, meta: { ...state.meta, latency: action.payload } };

    default:
      return state;
  }
}

export function AppProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, seedWithExceptions);
  const hydrated = useRef(false);

  // Restore a persisted demo session on first mount.
  useEffect(() => {
    try {
      const raw = window.localStorage.getItem(KEY);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (parsed && parsed.meta && parsed.meta.version === 1) {
          dispatch({ type: "__HYDRATE__", payload: parsed });
        }
      }
    } catch { /* ignore */ }
    hydrated.current = true;
  }, []);

  useEffect(() => {
    if (!hydrated.current) return;
    try { window.localStorage.setItem(KEY, JSON.stringify(state)); } catch { /* quota */ }
  }, [state]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>;
}

export function useStore() {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error("useStore must be used inside AppProvider");
  return ctx;
}

export function resetDemo() {
  try { window.localStorage.removeItem(KEY); } catch { /* ignore */ }
  window.location.href = "/";
}
