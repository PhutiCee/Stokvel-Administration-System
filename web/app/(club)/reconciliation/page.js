"use client";

/**
 * Reconciliation. REQ-96 to REQ-98.
 *
 * The Treasurer types in the balance shown by the bank; the system compares it
 * with the ledger pool balance and flags any gap. The system never holds or
 * moves money, so the bank figure is always entered by hand.
 */

import { useEffect, useState, useCallback } from "react";
import { AlertCircle, CheckCircle2, Scale } from "lucide-react";
import { PageHeader } from "@/components/shell/ClubShell";
import Button from "@/components/ui/Button";
import { Input, Textarea, Field } from "@/components/ui/Input";
import { Card, Badge, Alert, Loading, Empty } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { reconciliation as api, ApiError } from "@/lib/api";
import { money, fmtDate, fmtDateTime, cx } from "@/lib/format";

const today = () => new Date().toISOString().slice(0, 10);

function StatusBadge({ status }) {
  return status === "Balanced"
    ? <Badge tone="positive" icon={CheckCircle2}>Balanced</Badge>
    : <Badge tone="exception" icon={AlertCircle}>Gap</Badge>;
}

export default function ReconciliationPage() {
  const { can } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const load = useCallback(async (signal) => {
    try {
      setData(await api.list({ signal }));
      setError(null);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Could not load reconciliations.");
    }
  }, []);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  async function record(details) {
    const { reconciliation } = await api.record(details);
    setResult(reconciliation);
    await load();
  }

  if (error && !data) {
    return <Alert tone="exception" icon={AlertCircle} title="Could not load reconciliations">{error}</Alert>;
  }
  if (!data) return <Loading label="Loading reconciliations" />;

  return (
    <>
      <PageHeader
        title="Reconciliation"
        description="Compare the ledger's pool balance with the balance your bank shows, and flag any gap."
      />

      {error && <Alert tone="exception" icon={AlertCircle} className="mb-5">{error}</Alert>}

      <Card className="p-4 mb-5">
        <p className="text-[12px] text-ink-500">Ledger pool balance now</p>
        <p className="mt-1 text-xl font-semibold text-ink-900 font-mono">{money(data.ledgerBalance)}</p>
      </Card>

      {can("reconciliation.record") && (
        <RecordForm onSubmit={record} result={result} />
      )}

      <h2 className="mt-8 mb-3 text-sm font-semibold text-ink-900">History</h2>
      {data.reconciliations.length === 0 ? (
        <Card><Empty icon={Scale} title="No reconciliations yet" /></Card>
      ) : (
        <ul className="space-y-2">
          {data.reconciliations.map((r) => (
            <li key={r.reconciliationId}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14px] font-medium text-ink-900">As at {fmtDate(r.asAtDate)}</p>
                  <StatusBadge status={r.status} />
                </div>
                <dl className="mt-2 grid grid-cols-3 gap-3 text-[13px]">
                  <div><dt className="text-ink-500">Bank</dt><dd className="font-mono">{money(r.bankBalance)}</dd></div>
                  <div><dt className="text-ink-500">Ledger</dt><dd className="font-mono">{money(r.ledgerBalance)}</dd></div>
                  <div><dt className="text-ink-500">Difference</dt><dd className="font-mono">{money(r.difference, { sign: true })}</dd></div>
                </dl>
                {r.note && <p className="mt-2 text-[13px] text-ink-700 whitespace-pre-wrap">{r.note}</p>}
                <p className="mt-2 text-[12px] text-ink-500">
                  Recorded by {r.recordedBy} · {fmtDateTime(r.recordedAt)}
                </p>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}

function RecordForm({ onSubmit, result }) {
  const [bankBalance, setBankBalance] = useState("");
  const [asAtDate, setAsAtDate] = useState(today());
  const [note, setNote] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit(e) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ bankBalance, asAtDate, note });
      setBankBalance("");
      setNote("");
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="p-5">
      <form onSubmit={submit} className="space-y-4">
        <h2 className="text-sm font-semibold text-ink-900">Record a reconciliation</h2>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Bank balance (R)" htmlFor="bankBalance" required>
            <Input id="bankBalance" inputMode="decimal" placeholder="12500.00"
              value={bankBalance} onChange={(e) => setBankBalance(e.target.value)} />
          </Field>
          <Field label="As at" htmlFor="asAtDate" required>
            <Input id="asAtDate" type="date" max={today()}
              value={asAtDate} onChange={(e) => setAsAtDate(e.target.value)} />
          </Field>
        </div>
        <Field label="Note" htmlFor="note">
          <Textarea id="note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {error && <Alert tone="exception" icon={AlertCircle}>{error}</Alert>}

        {result && !error && (
          <Alert
            tone={result.status === "Balanced" ? "positive" : "exception"}
            icon={result.status === "Balanced" ? CheckCircle2 : AlertCircle}
            title={result.status === "Balanced" ? "The books agree" : "There is a gap"}
          >
            Bank {money(result.bankBalance)} against ledger {money(result.ledgerBalance)}
            {result.status === "Gap" && <> — difference <span className={cx("font-mono")}>{money(result.difference, { sign: true })}</span></>}.
          </Alert>
        )}

        <div className="flex justify-end">
          <Button type="submit" loading={busy} disabled={!bankBalance.trim() || !asAtDate}>Reconcile</Button>
        </div>
      </form>
    </Card>
  );
}
