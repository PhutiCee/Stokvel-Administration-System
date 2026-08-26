"use client";

import { useMemo, useState } from "react";
import { Search, Lock, Undo2, BookLock, Printer, X, CornerDownRight, Info } from "lucide-react";
import { useSession, useData, useQuery } from "@/lib/data";
import { money, fmtDate, fmtDateTime, cx } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Table, THead, TH, TR, TD } from "@/components/ui/Table";
import { Alert, EmptyState, SkeletonRows } from "@/components/ui/States";
import { Input, Textarea, Field } from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Dialog from "@/components/ui/Dialog";
import Money from "@/components/patterns/Money";
import PageHeader from "@/components/patterns/PageHeader";
import PrototypeNote from "@/components/patterns/Prototype";
import { useToast } from "@/components/ui/Toast";

const TYPES = ["All", "Contribution", "Penalty", "Payout", "Reversal", "Adjustment", "Interest"];

const TYPE_TONE = {
  Contribution: "neutral", Penalty: "attention", Payout: "neutral",
  Reversal: "accent", Adjustment: "accent", Interest: "positive"
};

export default function LedgerPage() {
  const { club, role, userId, dispatch } = useSession();
  const d = useData();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [type, setType] = useState("All");
  const [reversing, setReversing] = useState(null);
  const [page, setPage] = useState(1);
  const perPage = 25;

  const { data, loading } = useQuery(() => {
    if (!club) return null;
    const entries = d.ledgerFor(club.id).slice().sort((a, b) => new Date(b.postedAt) - new Date(a.postedAt));
    return { entries, pool: d.poolBalance(club.id), members: d.membersFor(club.id) };
  }, [club?.id]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.entries
      .filter((e) => (type === "All" ? true : e.type === type))
      .filter((e) => {
        if (!query) return true;
        const m = data.members.find((x) => x.id === e.memberId);
        return (m?.fullName || "").toLowerCase().includes(query.toLowerCase())
          || e.description.toLowerCase().includes(query.toLowerCase())
          || e.id.includes(query.toLowerCase());
      });
  }, [data, type, query]);

  const paged = filtered.slice((page - 1) * perPage, page * perPage);
  const pages = Math.max(1, Math.ceil(filtered.length / perPage));

  if (!club) return null;
  const canReverse = role === "Treasurer";

  function postReversal(entry, reason) {
    dispatch({ type: "POST_REVERSAL", payload: { entryId: entry.id, reason, actorId: userId } });
    setReversing(null);
    toast.push({
      tone: "success",
      title: "Reversing entry posted",
      description: "The original entry is untouched. Both are now permanently visible."
    });
  }

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Every movement of money in this club, in the order it happened. Entries are appended and never changed."
        meta={
          <>
            <Badge tone="accent">Pool {money(data?.pool ?? 0)}</Badge>
            <Badge tone="neutral" icon={Lock}>Append-only</Badge>
            <Badge tone="neutral">{data?.entries.length ?? 0} entries</Badge>
          </>
        }
        actions={<Button variant="secondary" onClick={() => window.print()} className="no-print"><Printer size={15} /> Print</Button>}
      />

      <Alert tone="neutral" icon={Lock} className="mb-5 no-print" title="Why there is no edit button on this screen">
        The audit trail is the club's protection against a treasurer's error or dishonesty, so nothing here can be
        amended or deleted, by any role. A mistake is corrected by posting a reversing entry of equal and opposite
        amount, and both the mistake and the correction stay on the record (REQ-90, REQ-91).
      </Alert>

      <Card>
        <div className="p-4 border-b border-line flex flex-col sm:flex-row gap-3 no-print">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input value={query} onChange={(e) => { setQuery(e.target.value); setPage(1); }}
              placeholder="Search by member, description or entry number" aria-label="Search the ledger" className="pl-9" />
          </div>
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {TYPES.map((t) => (
              <button key={t} onClick={() => { setType(t); setPage(1); }} aria-pressed={type === t}
                className={cx("px-3 h-9 rounded text-[13px] font-medium whitespace-nowrap border transition-colors",
                  type === t ? "bg-navy-950 text-white border-navy-950" : "bg-surface text-ink-700 border-line-strong hover:bg-canvas")}>
                {t}
              </button>
            ))}
          </div>
        </div>

        {loading ? <SkeletonRows rows={10} cols={5} /> : filtered.length === 0 ? (
          <EmptyState icon={BookLock} title="Nothing to show"
            description={query || type !== "All" ? "No entry matches this filter." : "This club has not recorded any money yet. The first contribution captured will appear here."}
            action={(query || type !== "All") && <Button variant="secondary" size="sm" onClick={() => { setQuery(""); setType("All"); }}>Clear filters</Button>} />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <TR>
                    <TH>Date</TH><TH>Entry</TH><TH>Member</TH><TH align="right">Amount</TH>
                    <TH align="right">Balance after</TH><TH align="right">Posted by</TH><TH align="right"><span className="no-print">Correct</span></TH>
                  </TR>
                </THead>
                <tbody>
                  {paged.map((e) => {
                    const m = data.members.find((x) => x.id === e.memberId);
                    const isReversal = !!e.reversesId;
                    const wasReversed = data.entries.some((x) => x.reversesId === e.id);
                    return (
                      <TR key={e.id} className={cx("hover:bg-canvas/60", isReversal && "bg-accent-50/40")}>
                        <TD className="tnum whitespace-nowrap text-[13px]">{fmtDate(e.postedAt)}</TD>
                        <TD>
                          <div className="flex items-start gap-2">
                            {isReversal && <CornerDownRight size={13} className="text-accent-600 mt-1 shrink-0" aria-hidden />}
                            <div className="min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <Badge tone={TYPE_TONE[e.type] || "neutral"}>{e.type}</Badge>
                                {wasReversed && <Badge tone="neutral">Reversed</Badge>}
                              </div>
                              <p className={cx("text-[13px] mt-1", wasReversed ? "text-ink-400 line-through" : "text-ink-700")}>
                                {e.description}
                              </p>
                              {e.reason && <p className="text-[12px] text-ink-500 mt-0.5 italic">{e.reason}</p>}
                            </div>
                          </div>
                        </TD>
                        <TD className="text-[13px]">{m?.fullName || <span className="text-ink-400">Club</span>}</TD>
                        <TD align="right"><Money value={e.amount} size="sm" tone={e.amount > 0 ? "positive" : "plain"} sign /></TD>
                        <TD align="right"><Money value={e.resultingBalance} size="sm" tone="muted" /></TD>
                        <TD align="right" className="text-[12px] text-ink-500 whitespace-nowrap">{d.userName(e.postedBy)}</TD>
                        <TD align="right" className="no-print">
                          {!wasReversed && !isReversal && e.type !== "Adjustment" ? (
                            <button
                              onClick={() => setReversing(e)} disabled={!canReverse}
                              className="inline-flex items-center gap-1 text-[12px] font-medium text-accent-600 hover:text-accent-700 disabled:text-ink-400 disabled:cursor-not-allowed transition-colors"
                              title={canReverse ? "Post a reversing entry" : "Only the treasurer may post a reversal"}
                            >
                              <Undo2 size={12} aria-hidden /> Reverse
                            </button>
                          ) : <span className="text-ink-400 text-[12px]">—</span>}
                        </TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            </div>

            {/* Mobile */}
            <ul className="md:hidden divide-y divide-line">
              {paged.map((e) => {
                const m = data.members.find((x) => x.id === e.memberId);
                const wasReversed = data.entries.some((x) => x.reversesId === e.id);
                return (
                  <li key={e.id} className={cx("px-4 py-3.5", e.reversesId && "bg-accent-50/40")}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <Badge tone={TYPE_TONE[e.type] || "neutral"}>{e.type}</Badge>
                          {wasReversed && <Badge tone="neutral">Reversed</Badge>}
                        </div>
                        <p className={cx("text-[13px] mt-1.5", wasReversed ? "text-ink-400 line-through" : "text-ink-900")}>
                          {m?.fullName || "Club"}
                        </p>
                        <p className="text-[12px] text-ink-500 mt-0.5">{e.description}</p>
                        <p className="text-[11px] text-ink-400 mt-1 tnum">{fmtDate(e.postedAt)} · {d.userName(e.postedBy)}</p>
                      </div>
                      <div className="text-right shrink-0">
                        <Money value={e.amount} size="sm" tone={e.amount > 0 ? "positive" : "plain"} sign />
                        <p className="text-[11px] text-ink-400 mt-1 tnum">bal {money(e.resultingBalance)}</p>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>

            {pages > 1 && (
              <div className="flex items-center justify-between gap-3 px-4 py-3 border-t border-line no-print">
                <p className="text-[12px] text-ink-500 tnum">
                  {(page - 1) * perPage + 1}–{Math.min(page * perPage, filtered.length)} of {filtered.length}
                </p>
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={page === 1} onClick={() => setPage((p) => p - 1)}>Previous</Button>
                  <Button size="sm" variant="secondary" disabled={page === pages} onClick={() => setPage((p) => p + 1)}>Next</Button>
                </div>
              </div>
            )}
          </>
        )}
      </Card>

      <PrototypeNote className="mt-5 no-print">
        The append-only property is honoured here by convention. In production a database-level rule rejects
        UPDATE and DELETE on posted rows, so it does not rest on application code alone (SDD 5.2.2).
      </PrototypeNote>

      {reversing && (
        <ReversalDialog entry={reversing} member={data.members.find((m) => m.id === reversing.memberId)}
          onClose={() => setReversing(null)} onConfirm={postReversal} />
      )}
    </>
  );
}

function ReversalDialog({ entry, member, onClose, onConfirm }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const valid = reason.trim().length >= 10;

  return (
    <Dialog
      open onClose={onClose} size="lg"
      title="Post a reversing entry"
      description="The original entry stays exactly as it is. This adds an equal and opposite entry beside it."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} loading={busy}
            onClick={() => { setBusy(true); setTimeout(() => onConfirm(entry, reason.trim()), 320); }}>
            Post the reversal
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-line divide-y divide-line">
          <div className="px-4 py-3 bg-canvas/60">
            <p className="text-[11px] uppercase tracking-wide text-ink-400 mb-1">The entry being corrected</p>
            <p className="text-[13px] text-ink-900">{entry.description}</p>
            <p className="text-[12px] text-ink-500 mt-0.5">
              {member?.fullName || "Club"} · {fmtDateTime(entry.postedAt)} · <span className="tnum">{money(entry.amount)}</span>
            </p>
          </div>
          <div className="px-4 py-3 flex items-center justify-between gap-4">
            <span className="text-[13px] text-ink-500">Reversing amount</span>
            <Money value={-entry.amount} sign />
          </div>
        </div>

        <Field
          label="Why is this being reversed?" htmlFor="reason" required
          hint="Recorded permanently against the reversing entry and visible to every officer. At least ten characters."
        >
          <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus
            placeholder="Captured against the wrong member: this payment was from Katlego Mabunda, not Sipho Nkuna." />
        </Field>

        <Alert tone="info" icon={Info}>
          After reversing, capture the correct entry separately. Anyone reading this ledger later will see the
          original, the reversal and the correction, in that order.
        </Alert>
      </div>
    </Dialog>
  );
}
