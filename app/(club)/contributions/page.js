"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, Wallet, CheckCircle2, Paperclip, Info, X } from "lucide-react";
import { useSession, useData, useQuery } from "@/lib/data";
import { money, fmtDate, cx } from "@/lib/format";
import { resolveContributionStatus, allocateExcess } from "@/lib/rules";
import { Card, CardHeader } from "@/components/ui/Card";
import { Table, THead, TH, TR, TD } from "@/components/ui/Table";
import { Alert, EmptyState, SkeletonRows } from "@/components/ui/States";
import { Input, Select, Field } from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Dialog from "@/components/ui/Dialog";
import Money from "@/components/patterns/Money";
import StatusBadge from "@/components/patterns/StatusBadge";
import PageHeader from "@/components/patterns/PageHeader";
import PrototypeNote from "@/components/patterns/Prototype";
import { useToast } from "@/components/ui/Toast";

const FILTERS = ["All", "Outstanding", "Partial", "Late", "Paid"];

export default function ContributionsPage() {
  const { club, role, userId, dispatch } = useSession();
  const d = useData();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [target, setTarget] = useState(null);
  const [sessionTotal, setSessionTotal] = useState(0);
  const [sessionCount, setSessionCount] = useState(0);

  const { data, loading } = useQuery(() => {
    if (!club) return null;
    const cycle = d.openCycle(club.id);
    const constitution = d.constitutionFor(club.id);
    const rows = d.contributionsFor(club.id, cycle?.id).map((c) => ({
      ...c,
      member: d.membersFor(club.id).find((m) => m.id === c.memberId)
    })).filter((r) => r.member);
    return { cycle, constitution, rows };
  }, [club?.id]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.rows
      .filter((r) => (filter === "All" ? true : r.status === filter))
      .filter((r) => r.member.fullName.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => {
        const order = { Late: 0, Outstanding: 1, Partial: 2, Paid: 3 };
        return order[a.status] - order[b.status] || a.member.fullName.localeCompare(b.member.fullName);
      });
  }, [data, filter, query]);

  if (!club) return null;

  const canCapture = role === "Treasurer";
  const totals = data ? {
    expected: data.rows.reduce((a, r) => a + r.expectedAmount, 0),
    captured: data.rows.reduce((a, r) => a + r.capturedAmount, 0)
  } : { expected: 0, captured: 0 };

  function onCaptured(result) {
    setSessionTotal((t) => t + result.amount);
    setSessionCount((c) => c + 1);
    toast.push({
      tone: "success",
      title: `${money(result.amount)} captured for ${result.name}`,
      description: result.note
    });
    setTarget(null);
  }

  return (
    <>
      <PageHeader
        title="Contributions"
        description={
          data?.cycle
            ? `Cycle ${data.cycle.sequenceNumber}, opened ${fmtDate(data.cycle.startDate)}. Due ${fmtDate(data.cycle.dueDate)}, with ${data.constitution.gracePeriodDays} days of grace before a ${money(data.constitution.penaltyAmount)} penalty applies.`
            : "No cycle is open."
        }
        meta={
          <>
            <Badge tone="accent">Expected {money(totals.expected)}</Badge>
            <Badge tone={totals.captured >= totals.expected ? "positive" : "neutral"}>Captured {money(totals.captured)}</Badge>
            {sessionCount > 0 && (
              <Badge tone="positive" icon={CheckCircle2}>
                This session: {sessionCount} payment{sessionCount > 1 ? "s" : ""}, {money(sessionTotal)}
              </Badge>
            )}
          </>
        }
      />

      {!canCapture && (
        <Alert tone="neutral" icon={Info} className="mb-5" title="You are viewing, not capturing">
          Capture is reserved for the treasurer. You can see every member's position for this cycle.
        </Alert>
      )}

      <Card>
        <div className="p-4 border-b border-line flex flex-col sm:flex-row gap-3 sm:items-center">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input
              value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Find a member" aria-label="Search members" className="pl-9 pr-8"
            />
            {query && (
              <button onClick={() => setQuery("")} aria-label="Clear search" className="absolute right-2.5 top-1/2 -translate-y-1/2 text-ink-400 hover:text-ink-700">
                <X size={14} />
              </button>
            )}
          </div>
          <div className="flex gap-1 overflow-x-auto no-scrollbar -mx-1 px-1">
            {FILTERS.map((f) => {
              const count = data?.rows.filter((r) => f === "All" || r.status === f).length || 0;
              return (
                <button
                  key={f} onClick={() => setFilter(f)}
                  aria-pressed={filter === f}
                  className={cx(
                    "px-3 h-9 rounded text-[13px] font-medium whitespace-nowrap transition-colors border",
                    filter === f ? "bg-navy-950 text-white border-navy-950" : "bg-surface text-ink-700 border-line-strong hover:bg-canvas"
                  )}
                >
                  {f} <span className="tnum opacity-60">{count}</span>
                </button>
              );
            })}
          </div>
        </div>

        {loading ? <SkeletonRows rows={8} cols={5} />
          : filtered.length === 0 ? (
            <EmptyState
              icon={Search}
              title={query ? `Nobody matches “${query}”` : `Nothing is ${filter.toLowerCase()}`}
              description={query ? "Check the spelling, or clear the search to see everyone in this cycle." : "Try another filter to see the rest of the cycle."}
              action={<Button variant="secondary" size="sm" onClick={() => { setQuery(""); setFilter("All"); }}>Show everyone</Button>}
            />
          ) : (
            <>
              {/* Desktop table */}
              <div className="hidden md:block">
                <Table>
                  <THead>
                    <TR>
                      <TH>Member</TH><TH align="right">Expected</TH><TH align="right">Captured</TH>
                      <TH align="right">Outstanding</TH><TH>Status</TH><TH align="right">Action</TH>
                    </TR>
                  </THead>
                  <tbody>
                    {filtered.map((r) => {
                      const out = Math.max(0, r.expectedAmount - r.capturedAmount);
                      return (
                        <TR key={r.id} className="hover:bg-canvas/60">
                          <TD>
                            <Link href={`/members/${r.member.id}`} className="text-ink-900 font-medium hover:text-accent-600 transition-colors">
                              {r.member.fullName}
                            </Link>
                            {r.member.standing !== "Good standing" && (
                              <span className="ml-2"><StatusBadge status={r.member.standing} /></span>
                            )}
                            {r.proofOfPayment && (
                              <span className="ml-2 inline-flex items-center gap-1 text-[11px] text-ink-400">
                                <Paperclip size={10} aria-hidden /> proof
                              </span>
                            )}
                          </TD>
                          <TD align="right"><Money value={r.expectedAmount} tone="muted" size="sm" /></TD>
                          <TD align="right"><Money value={r.capturedAmount} size="sm" /></TD>
                          <TD align="right">
                            {out > 0 ? <Money value={out} tone="exception" size="sm" /> : <span className="text-ink-400">—</span>}
                          </TD>
                          <TD><StatusBadge status={r.status} /></TD>
                          <TD align="right">
                            <Button size="sm" variant={out > 0 ? "primary" : "secondary"} disabled={!canCapture}
                              onClick={() => setTarget(r)}>
                              {out > 0 ? "Capture" : "Capture more"}
                            </Button>
                          </TD>
                        </TR>
                      );
                    })}
                  </tbody>
                </Table>
              </div>

              {/* Mobile: the same rows as cards, because a six-column table at 360px is unusable */}
              <ul className="md:hidden divide-y divide-line">
                {filtered.map((r) => {
                  const out = Math.max(0, r.expectedAmount - r.capturedAmount);
                  return (
                    <li key={r.id} className="px-4 py-3.5">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="text-[14px] font-medium text-ink-900 truncate">{r.member.fullName}</p>
                          <p className="text-[12px] text-ink-500 mt-0.5 tnum">
                            {money(r.capturedAmount)} of {money(r.expectedAmount)}
                            {out > 0 && <span className="text-exc-600"> · {money(out)} short</span>}
                          </p>
                        </div>
                        <StatusBadge status={r.status} />
                      </div>
                      <Button size="sm" variant={out > 0 ? "primary" : "secondary"} disabled={!canCapture}
                        className="mt-3 w-full" onClick={() => setTarget(r)}>
                        {out > 0 ? "Capture payment" : "Capture more"}
                      </Button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
      </Card>

      <PrototypeNote className="mt-5">
        Capture writes to in-memory state, not to a database. In production the contribution and its ledger
        entry are written inside one transaction, so that they either both persist or neither does (REQ-89, SRS 6.1).
      </PrototypeNote>

      {target && (
        <CaptureDialog
          row={target} constitution={data.constitution} cycle={data.cycle}
          onClose={() => setTarget(null)}
          onDone={onCaptured}
          allContributions={d.contributionsFor(club.id).filter((c) => c.memberId === target.memberId)}
          cycles={d.cyclesFor(club.id)}
          ledger={d.ledgerFor(club.id)}
          dispatch={dispatch} actorId={userId}
        />
      )}
    </>
  );
}

function CaptureDialog({ row, constitution, cycle, onClose, onDone, allContributions, cycles, ledger, dispatch, actorId }) {
  const outstanding = Math.max(0, row.expectedAmount - row.capturedAmount);
  const [amount, setAmount] = useState(outstanding > 0 ? String(outstanding) : "");
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [proof, setProof] = useState(false);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [confirming, setConfirming] = useState(false);

  const value = Number(amount);
  const excess = Math.max(0, value - outstanding);

  // The excess cascade is computed by the rules engine, not by this component.
  const unpaidPenalties = ledger
    .filter((e) => e.memberId === row.memberId && e.type === "Penalty")
    .filter((p) => !ledger.some((e) => e.reversesId === p.id))
    .map((p) => ({ id: p.id, amount: p.amount, label: p.description }));
  const arrears = allContributions
    .filter((c) => c.cycleId !== cycle.id && c.capturedAmount < c.expectedAmount)
    .map((c) => {
      const cy = cycles.find((x) => x.id === c.cycleId);
      return { id: c.id, outstanding: c.expectedAmount - c.capturedAmount, dueDate: cy?.dueDate, label: `Cycle ${cy?.sequenceNumber} arrears` };
    });
  const allocation = excess > 0 ? allocateExcess({ excess, outstandingPenalties: unpaidPenalties, arrears }) : [];

  function validate() {
    if (!amount.trim()) return "Enter the amount received.";
    if (Number.isNaN(value)) return "That is not a number. Enter the amount in Rand, for example 500.";
    if (value <= 0) return "The amount must be more than zero (REQ-60).";
    if (method === "Electronic funds transfer" && !reference.trim()) return "A transfer needs its reference (REQ-52).";
    if (cycle.status !== "Open") return "This cycle is closed. A reversing entry is required instead (REQ-59).";
    return null;
  }

  function submit() {
    const err = validate();
    if (err) { setError(err); return; }
    if (!confirming) { setConfirming(true); return; }

    setBusy(true);
    const status = resolveContributionStatus({
      expected: row.expectedAmount,
      captured: row.capturedAmount + Math.min(value, outstanding || value),
      dueDate: cycle.dueDate,
      graceDays: constitution.gracePeriodDays
    });

    setTimeout(() => {
      dispatch({
        type: "CAPTURE_CONTRIBUTION",
        payload: {
          contributionId: row.id, amount: value, receiptDate: date, method,
          reference: reference || null, actorId, status,
          proofOfPayment: proof ? "proof-of-payment.jpg" : null
        }
      });
      onDone({
        amount: value, name: row.member.fullName,
        note: excess > 0
          ? `${money(excess)} over. ${allocation.map((a) => `${money(a.amount)} to ${a.label.toLowerCase()}`).join("; ")}.`
          : status === "Partial" ? `${money(row.expectedAmount - row.capturedAmount - value)} still outstanding for this cycle.` : undefined
      });
      setBusy(false);
    }, 380);
  }

  return (
    <Dialog
      open onClose={onClose} size="lg"
      title={confirming ? "Confirm this capture" : `Capture a payment from ${row.member.fullName}`}
      description={confirming ? "Nothing is posted until you confirm. Once posted it cannot be edited, only reversed." : `Cycle ${cycle.sequenceNumber}. Expected ${money(row.expectedAmount)}.`}
      footer={
        <>
          <Button variant="secondary" onClick={confirming ? () => setConfirming(false) : onClose}>
            {confirming ? "Back" : "Cancel"}
          </Button>
          <Button onClick={submit} loading={busy}>
            {confirming ? "Post to the ledger" : "Review"}
          </Button>
        </>
      }
    >
      {confirming ? (
        <div className="space-y-4">
          <dl className="rounded-lg border border-line divide-y divide-line">
            {[
              ["Member", row.member.fullName],
              ["Amount received", money(value)],
              ["Date of receipt", fmtDate(date)],
              ["Method", method + (reference ? ` · ${reference}` : "")],
              ["Resulting status", null]
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <dt className="text-[13px] text-ink-500">{k}</dt>
                <dd className="text-[13px] font-medium text-ink-900 tnum text-right">
                  {v ?? <StatusBadge status={resolveContributionStatus({
                    expected: row.expectedAmount,
                    captured: row.capturedAmount + value,
                    dueDate: cycle.dueDate,
                    graceDays: constitution.gracePeriodDays
                  })} />}
                </dd>
              </div>
            ))}
          </dl>

          {allocation.length > 0 && (
            <Alert tone="info" icon={Info} title={`${money(excess)} is more than this cycle needs`}>
              <ul className="mt-1 space-y-0.5">
                {allocation.map((a, i) => (
                  <li key={i} className="tnum">{money(a.amount)} → {a.label}</li>
                ))}
              </ul>
              <p className="mt-1.5 opacity-80">Penalties first, then the oldest arrears, then credit forward (REQ-57).</p>
            </Alert>
          )}

          <Alert tone="warning" title="This is final">
            Once posted, this entry stays in the ledger permanently. A mistake is corrected by a reversing entry,
            which leaves both the error and the correction visible.
          </Alert>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Amount received" htmlFor="amt" required
              hint={outstanding > 0 ? `${money(outstanding)} outstanding for this cycle` : "This cycle is already fully paid"}
              error={error && error.includes("amount") ? error : null}>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">R</span>
                <Input id="amt" inputMode="decimal" value={amount} data-autofocus
                  onChange={(e) => { setAmount(e.target.value); setError(null); }}
                  className="pl-7 tnum" invalid={!!error && error.includes("amount")} />
              </div>
            </Field>

            <Field label="Date of receipt" htmlFor="date" required>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="tnum" />
            </Field>

            <Field label="Payment method" htmlFor="method" required>
              <Select id="method" value={method} onChange={(e) => { setMethod(e.target.value); setError(null); }}>
                <option>Cash</option>
                <option>Electronic funds transfer</option>
                <option>Other</option>
              </Select>
            </Field>

            {method === "Electronic funds transfer" && (
              <Field label="Transaction reference" htmlFor="ref" required
                hint="Shown on the bank statement" error={error && error.includes("reference") ? error : null}>
                <Input id="ref" value={reference} onChange={(e) => { setReference(e.target.value); setError(null); }}
                  placeholder="EFT48210" invalid={!!error && error.includes("reference")} />
              </Field>
            )}
          </div>

          <label className="flex items-start gap-2.5 rounded-lg border border-line px-3.5 py-3 cursor-pointer hover:bg-canvas transition-colors">
            <input type="checkbox" checked={proof} onChange={(e) => setProof(e.target.checked)} className="mt-0.5 accent-accent-600" />
            <span>
              <span className="block text-[13px] font-medium text-ink-900">Attach a proof of payment</span>
              <span className="block text-[12px] text-ink-500 mt-0.5">JPEG, PNG or PDF up to 5 MB (REQ-53). In the prototype this only sets a flag; no file is uploaded.</span>
            </span>
          </label>

          {excess > 0 && (
            <Alert tone="info" icon={Info} title={`${money(excess)} more than this cycle needs`}>
              It will be applied to penalties first, then to the oldest arrears, then held as credit against the next cycle.
            </Alert>
          )}

          {error && !error.includes("amount") && !error.includes("reference") && (
            <Alert tone="exception">{error}</Alert>
          )}
        </div>
      )}
    </Dialog>
  );
}
