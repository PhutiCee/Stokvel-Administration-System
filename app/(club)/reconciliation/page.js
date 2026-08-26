"use client";

import { useState } from "react";
import { Scale, ShieldAlert, CheckCircle2, Info, ArrowRight, Landmark } from "lucide-react";
import { useSession, useData, useQuery } from "@/lib/data";
import { money, fmtDate, cx } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Alert, EmptyState, Skeleton } from "@/components/ui/States";
import { Input, Textarea, Field } from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import Money from "@/components/patterns/Money";
import StatusBadge from "@/components/patterns/StatusBadge";
import PageHeader from "@/components/patterns/PageHeader";
import PrototypeNote from "@/components/patterns/Prototype";
import { useToast } from "@/components/ui/Toast";

export default function ReconciliationPage() {
  const { club, role, userId, dispatch } = useSession();
  const d = useData();
  const toast = useToast();
  const [recording, setRecording] = useState(false);
  const [explaining, setExplaining] = useState(false);

  const { data, loading } = useQuery(() => {
    if (!club) return null;
    const derived = d.poolBalance(club.id);
    const captured = d.contributionsFor(club.id).reduce((a, c) => a + c.capturedAmount, 0);
    return {
      derived, captured,
      latest: d.latestReconciliation(club.id),
      history: d.state.reconciliations.filter((r) => r.clubId === club.id)
        .sort((a, b) => new Date(b.asAtDate) - new Date(a.asAtDate))
    };
  }, [club?.id]);

  if (!club) return null;
  const canRecord = role === "Treasurer";
  const latest = data?.latest;
  const difference = latest ? Math.round((latest.bankBalance - (data?.derived ?? 0)) * 100) / 100 : null;
  const isException = difference !== null && difference !== 0;

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="What the ledger says the club holds, set against what the bank says it holds. Any gap is investigated, never explained away quietly."
        actions={canRecord && <Button onClick={() => setRecording(true)}><Landmark size={15} /> Record a bank balance</Button>}
      />

      {loading ? <Skeleton className="h-48 w-full rounded-lg" /> : !latest ? (
        <Card>
          <EmptyState
            icon={Scale} title="No reconciliation recorded yet"
            description="Enter the closing balance from the club's bank statement and the system will compare it against the ledger."
            action={canRecord && <Button onClick={() => setRecording(true)}>Record a bank balance</Button>}
          />
        </Card>
      ) : (
        <div className="space-y-5">
          <Card className={cx("overflow-hidden", isException ? "border-exc-600/30" : "border-pos-600/30")}>
            <div className={cx("px-5 py-5 sm:px-7 sm:py-6 flex flex-col sm:flex-row sm:items-center gap-4 justify-between",
              isException ? "bg-exc-50" : "bg-pos-50")}>
              <div className="flex items-start gap-3.5">
                {isException
                  ? <ShieldAlert size={22} className="text-exc-600 shrink-0 mt-0.5" aria-hidden />
                  : <CheckCircle2 size={22} className="text-pos-600 shrink-0 mt-0.5" aria-hidden />}
                <div>
                  <p className={cx("text-[15px] font-semibold", isException ? "text-exc-700" : "text-pos-700")}>
                    {isException ? "The pool and the bank do not agree" : "The pool agrees with the bank"}
                  </p>
                  <p className={cx("text-[13px] mt-1 leading-relaxed max-w-lg", isException ? "text-exc-700/85" : "text-pos-700/85")}>
                    {isException
                      ? "Something has been received and not banked, banked and not captured, or captured twice. Until it is traced and explained, the difference stays on the record."
                      : `Everything the ledger records is in the account, as at ${fmtDate(latest.asAtDate)}.`}
                  </p>
                </div>
              </div>
              <div className="text-right shrink-0">
                <p className={cx("text-[11px] uppercase tracking-wide", isException ? "text-exc-700/70" : "text-pos-700/70")}>Difference</p>
                <Money value={difference} size="xxl" tone={isException ? "exception" : "positive"} sign />
              </div>
            </div>

            <CardBody className="grid sm:grid-cols-3 gap-5">
              <Figure label="Pool balance from the ledger" value={data.derived}
                hint="Every entry, added up. This is the authoritative figure." />
              <Figure label="Contributions captured" value={data.captured}
                hint="Money in, before penalties and payouts." />
              <Figure label="Bank balance recorded" value={latest.bankBalance}
                hint={`Entered by ${d.userName(latest.recordedBy)} as at ${fmtDate(latest.asAtDate)}.`} />
            </CardBody>

            {isException && (
              <div className="px-5 py-4 border-t border-line bg-canvas/50">
                <p className="text-[13px] font-medium text-ink-900 mb-2.5">How this gets cleared</p>
                <ol className="space-y-1.5 text-[13px] text-ink-700">
                  {[
                    "Trace it. A capture error is corrected in the ledger by a reversing entry and a fresh capture.",
                    "If it cannot be traced, post an explanatory entry saying what you believe happened.",
                    "There is no third option. The difference cannot simply be dismissed (REQ-98)."
                  ].map((t, i) => (
                    <li key={i} className="flex gap-2.5">
                      <span className="w-5 h-5 rounded-full bg-ink-900/5 grid place-items-center text-[11px] font-semibold tnum shrink-0">{i + 1}</span>
                      <span className="leading-relaxed">{t}</span>
                    </li>
                  ))}
                </ol>
                {canRecord && (
                  <div className="flex flex-col sm:flex-row gap-2 mt-4">
                    <Button size="sm" onClick={() => setExplaining(true)}>Post an explanatory entry</Button>
                    <Button size="sm" variant="secondary" onClick={() => setRecording(true)}>Re-enter the bank balance</Button>
                  </div>
                )}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Reconciliation history" description="Recorded at each month-end so a discrepancy surfaces within one cycle (SRS 5.2)" />
            <ul className="divide-y divide-line">
              {data.history.map((r) => (
                <li key={r.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[13px] font-medium text-ink-900 tnum">As at {fmtDate(r.asAtDate)}</p>
                    <p className="text-[12px] text-ink-500 mt-0.5 tnum">
                      Ledger {money(r.derivedBalance)} · bank {money(r.bankBalance)}
                    </p>
                    {r.note && <p className="text-[12px] text-ink-500 mt-1 italic">{r.note}</p>}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <Money value={r.difference} size="sm" tone={r.difference === 0 ? "muted" : "exception"} sign />
                    <StatusBadge status={r.status} />
                  </div>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}

      <PrototypeNote className="mt-5">
        Bank balances are typed in by the treasurer. This system deliberately has no banking integration: it
        records money, it does not move or read it (BR-20).
      </PrototypeNote>

      <RecordDialog open={recording} onClose={() => setRecording(false)} derived={data?.derived ?? 0}
        onSave={(bankBalance, asAtDate) => {
          dispatch({ type: "RECORD_BANK_BALANCE", payload: { clubId: club.id, bankBalance, asAtDate, actorId: userId } });
          setRecording(false);
          const diff = Math.round((bankBalance - (data?.derived ?? 0)) * 100) / 100;
          toast.push({
            tone: diff === 0 ? "success" : "warning",
            title: diff === 0 ? "Reconciled clean" : `Difference of ${money(Math.abs(diff))}`,
            description: diff === 0 ? "The ledger and the bank agree exactly." : "It is now flagged as an exception on the dashboard."
          });
        }} />

      <ExplainDialog open={explaining} onClose={() => setExplaining(false)} difference={difference ?? 0}
        onSave={(reason) => {
          dispatch({ type: "EXPLAIN_DIFFERENCE", payload: { clubId: club.id, amount: difference, reason, actorId: userId } });
          setExplaining(false);
          toast.push({
            tone: "success", title: "Explanatory entry posted",
            description: "The difference is cleared, and the explanation is part of the audit trail."
          });
        }} />
    </>
  );
}

function Figure({ label, value, hint }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
      <p className="mt-1.5"><Money value={value} size="lg" /></p>
      <p className="text-[12px] text-ink-500 mt-1 leading-relaxed">{hint}</p>
    </div>
  );
}

function RecordDialog({ open, onClose, derived, onSave }) {
  const [balance, setBalance] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [error, setError] = useState(null);
  const value = Number(balance);
  const diff = balance === "" ? null : Math.round((value - derived) * 100) / 100;

  return (
    <Dialog
      open={open} onClose={onClose}
      title="Record the bank balance"
      description="Take the closing balance from the club's bank statement and the date it relates to."
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button onClick={() => {
            if (balance === "" || Number.isNaN(value)) { setError("Enter the closing balance as a number."); return; }
            onSave(value, new Date(date).toISOString()); setBalance(""); setError(null);
          }}>Compare against the ledger</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Closing balance on the statement" htmlFor="bal" required error={error}>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-500 text-sm">R</span>
            <Input id="bal" inputMode="decimal" value={balance} data-autofocus
              onChange={(e) => { setBalance(e.target.value); setError(null); }} className="pl-7 tnum" invalid={!!error} />
          </div>
        </Field>
        <Field label="As at" htmlFor="asat" required>
          <Input id="asat" type="date" value={date} onChange={(e) => setDate(e.target.value)} className="tnum" />
        </Field>

        <div className="rounded-lg border border-line divide-y divide-line bg-canvas/40">
          <Row label="Ledger says the pool is" value={money(derived)} />
          <Row label="Difference" value={diff === null ? "—" : money(diff)}
            tone={diff !== null && diff !== 0 ? "exception" : "plain"} />
        </div>

        {diff !== null && diff !== 0 && (
          <Alert tone="warning" icon={Info}>
            A difference will be flagged as an exception on the dashboard and cannot be dismissed without an
            explanatory entry.
          </Alert>
        )}
      </div>
    </Dialog>
  );
}

function ExplainDialog({ open, onClose, difference, onSave }) {
  const [reason, setReason] = useState("");
  const valid = reason.trim().length >= 15;
  return (
    <Dialog
      open={open} onClose={onClose}
      title="Post an explanatory entry"
      description={`This adds ${money(difference)} to the ledger with your explanation attached, and closes the difference.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button disabled={!valid} onClick={() => { onSave(reason.trim()); setReason(""); }}>Post the entry</Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="What happened?" htmlFor="explain" required
          hint="Recorded permanently in the ledger. Write it for whoever reads this in three years' time.">
          <Textarea id="explain" value={reason} onChange={(e) => setReason(e.target.value)} data-autofocus
            placeholder="R450 received in cash from Katlego Mabunda at the October meeting and captured, but not yet deposited. It is being banked on Monday." />
        </Field>
        <Alert tone="info" icon={Info}>
          The explanation itself becomes part of the audit trail, which is the point: a gap is never cleared
          silently, only accounted for.
        </Alert>
      </div>
    </Dialog>
  );
}

function Row({ label, value, tone }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <span className="text-[13px] text-ink-500">{label}</span>
      <span className={cx("text-[13px] font-medium tnum", tone === "exception" ? "text-exc-600" : "text-ink-900")}>{value}</span>
    </div>
  );
}
