"use client";

/**
 * Year-end distributions. Use Case 3, accumulating clubs. REQ-79 to REQ-82.
 *
 * The itemised computation is the point of this screen (REQ-82): the
 * Chairperson approves the specific breakdown shown, not a number recomputed
 * behind the scenes, so every member's figure is on the page before anyone
 * commits to it.
 */

import { useEffect, useState, useCallback } from "react";
import { AlertCircle, PiggyBank, Check, X, TrendingUp, TrendingDown } from "lucide-react";
import { PageHeader } from "@/components/shell/ClubShell";
import Button from "@/components/ui/Button";
import { Input, Textarea, Field } from "@/components/ui/Input";
import { Card, Badge, Alert, Loading, Empty } from "@/components/ui/States";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useSession } from "@/lib/session";
import { distributions as api, ApiError } from "@/lib/api";
import { money, fmtDate, fmtDateTime } from "@/lib/format";

const STATUS_TONE = { Initiated: "attention", Approved: "positive", Cancelled: "neutral" };

export default function DistributionsPage() {
  const { club, can } = useSession();
  const [preview, setPreview] = useState(null);
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [recording, setRecording] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(async (signal) => {
    try {
      const [p, l] = await Promise.all([api.next({ signal }), api.list({ signal })]);
      setPreview(p);
      setList(l.distributions);
      setError(null);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Could not load distributions.");
    }
  }, []);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  async function act(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (club?.clubType !== "Accumulating") {
    return (
      <>
        <PageHeader title="Distributions" />
        <Card>
          <Empty icon={PiggyBank} title="Not applicable to this club">
            Only an accumulating club distributes the whole pool at year-end.
          </Empty>
        </Card>
      </>
    );
  }

  if (error && !list) {
    return <Alert tone="exception" icon={AlertCircle} title="Could not load distributions">{error}</Alert>;
  }
  if (!list) return <Loading label="Loading distributions" />;

  const open = list.find((d) => d.status === "Initiated");

  return (
    <>
      <PageHeader
        title="Year-end distribution"
        description="Every member's contributions, less unwaived penalties, plus a share of interest earned, less a share of costs."
        action={
          !open && can("distribution.recordFinancials") && (
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => setRecording("interest")}>
                <TrendingUp size={13} aria-hidden /> Record interest
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setRecording("expense")}>
                <TrendingDown size={13} aria-hidden /> Record a cost
              </Button>
            </div>
          )
        }
      />

      {error && <Alert tone="exception" icon={AlertCircle} className="mb-5">{error}</Alert>}

      {open ? (
        <OpenDistribution
          distribution={open}
          can={can}
          onApprove={() => setConfirmation({ title: "Approve distribution", description: "Post all member payments for this distribution? Review the allocations before confirming.", run: () => api.approve(open.distributionId) })}
          onCancel={() => setCancelling(open)}
          busy={busy}
        />
      ) : (
        <PreviewCard preview={preview} can={can} onInitiate={() => setConfirmation({ title: "Initiate distribution", description: "Submit the displayed allocations for approval by a different officer?", run: () => api.initiate() })} busy={busy} />
      )}

      <h2 className="text-sm font-semibold text-ink-900 mt-8 mb-3">History</h2>
      {list.length === 0 ? (
        <Card><Empty icon={PiggyBank} title="No distribution has been made yet" /></Card>
      ) : (
        <ul className="space-y-2">
          {list.map((d) => (
            <li key={d.distributionId}>
              <Card className="p-4 flex items-center justify-between gap-3">
                <div>
                  <p className="text-[14px] text-ink-900">Year-end {d.yearEndDate}</p>
                  <p className="text-[12.5px] text-ink-500 mt-0.5">
                    {money(d.totals.distributed)} across {d.perMember.length} members
                  </p>
                </div>
                <Badge tone={STATUS_TONE[d.status]}>{d.status}</Badge>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {recording && (
        <RecordFinancialDialog
          kind={recording}
          onClose={() => setRecording(null)}
          onSubmit={(amount, description) =>
            act(() => (recording === "interest" ? api.recordInterest(amount, description) : api.recordExpense(amount, description)))
          }
        />
      )}

      {confirmation && <ConfirmDialog title={confirmation.title} description={confirmation.description}
        requireReason={false} confirmVariant="primary" onClose={() => setConfirmation(null)}
        onConfirm={async () => { await confirmation.run(); await load(); }} />}
      {cancelling && (
        <ConfirmDialog
          title="Cancel this distribution"
          description="No member will be paid unless a distribution is initiated again for this year-end date."
          confirmLabel="Cancel the distribution"
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => act(() => api.cancel(cancelling.distributionId, reason))}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function PreviewCard({ preview, can, onInitiate, busy }) {
  if (!preview) return <Loading label="Assessing the next distribution" />;
  if (!preview.applicable) return null;

  if (!preview.yearEndDate) {
    return (
      <Card><Empty icon={PiggyBank} title="No year-end date set">The constitution does not name a year-end date.</Empty></Card>
    );
  }

  if (!preview.isDue) {
    return (
      <Card>
        <Empty icon={PiggyBank} title={`Not due until ${fmtDate(preview.yearEndDate)}`}>
          The next distribution covers activity up to that date.
        </Empty>
      </Card>
    );
  }

  return (
    <Card>
      <div className="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Year-end {fmtDate(preview.yearEndDate)}</h2>
          <p className="text-[13px] text-ink-500 mt-0.5">
            Interest {money(preview.interest)} · Costs {money(preview.expenses)} · Pool {money(preview.poolBalance)}
          </p>
        </div>
        <Badge tone={preview.eligible ? "positive" : "neutral"}>{preview.eligible ? "Ready" : "Not yet"}</Badge>
      </div>
      <div className="p-5">
        {!preview.eligible && (
          <div className="space-y-2 mb-4">
            {preview.refusals.map((r, i) => (
              <Alert key={i} tone="exception" icon={AlertCircle}>{r.message}</Alert>
            ))}
          </div>
        )}

        {preview.shares && <SharesTable perMember={preview.shares.perMember} total={preview.shares.totalDistributed} />}

        {preview.eligible && can("distribution.initiate") && (
          <Button onClick={onInitiate} loading={busy} className="mt-4">
            Initiate distribution of {money(preview.shares.totalDistributed)}
          </Button>
        )}
      </div>
    </Card>
  );
}

function OpenDistribution({ distribution, can, onApprove, onCancel, busy }) {
  return (
    <Card className="border-warn-600/25">
      <div className="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Waiting for approval</h2>
          <p className="text-[13px] text-ink-500 mt-0.5">
            Initiated by {distribution.initiated.by}, {fmtDateTime(distribution.initiated.at)}
          </p>
        </div>
        <Badge tone="attention">{distribution.status}</Badge>
      </div>
      <div className="p-5">
        {distribution.assessmentNow && !distribution.assessmentNow.eligible && (
          <div className="space-y-2 mb-4">
            {distribution.assessmentNow.refusals.map((r, i) => (
              <Alert key={i} tone="exception" icon={AlertCircle} title="No longer eligible">{r.message}</Alert>
            ))}
          </div>
        )}

        <SharesTable perMember={distribution.perMember} total={distribution.totals.distributed} />

        <div className="flex gap-2 mt-4">
          {can("distribution.approve") && (
            <Button onClick={onApprove} loading={busy}>
              <Check size={14} aria-hidden /> Approve
            </Button>
          )}
          {can("distribution.cancel") && (
            <Button onClick={onCancel} variant="secondary" disabled={busy}>
              <X size={14} aria-hidden /> Cancel
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}

function SharesTable({ perMember, total }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-[13px] border-collapse min-w-[560px]">
        <thead>
          <tr className="border-b border-line text-ink-500 text-left">
            <th scope="col" className="font-medium py-2">Member</th>
            <th scope="col" className="font-medium py-2 text-right">Captured</th>
            <th scope="col" className="font-medium py-2 text-right">Penalties</th>
            <th scope="col" className="font-medium py-2 text-right">Interest</th>
            <th scope="col" className="font-medium py-2 text-right">Costs</th>
            <th scope="col" className="font-medium py-2 text-right">Final</th>
          </tr>
        </thead>
        <tbody>
          {perMember.map((m) => (
            <tr key={m.memberId} className="border-b border-line last:border-0">
              <td className="py-2 text-ink-900">{m.fullName}</td>
              <td className="py-2 text-right font-mono tnum text-ink-500">{money(m.captured)}</td>
              <td className="py-2 text-right font-mono tnum text-ink-500">{money(m.penalties)}</td>
              <td className="py-2 text-right font-mono tnum text-pos-700">{money(m.interestShare)}</td>
              <td className="py-2 text-right font-mono tnum text-exc-700">{money(m.expenseShare)}</td>
              <td className="py-2 text-right font-mono tnum text-ink-900 font-medium">{money(m.finalAmount)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr>
            <td className="py-2 text-ink-500" colSpan={5}>Total distributed</td>
            <td className="py-2 text-right font-mono tnum text-ink-900 font-medium">{money(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function RecordFinancialDialog({ kind, onClose, onSubmit }) {
  const [amount, setAmount] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit(amount, description);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  const label = kind === "interest" ? "interest earned" : "administrative cost";

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-5" role="dialog" aria-modal="true" aria-label={`Record ${label}`}>
      <Card className="w-full max-w-md p-5 shadow-pop animate-slideUp">
        <h2 className="text-sm font-semibold text-ink-900">Record {label}</h2>
        <p className="mt-1.5 text-[13px] text-ink-500 leading-relaxed">
          Shared out among members at the next distribution, in proportion to what each contributed.
        </p>

        <div className="mt-4 space-y-4">
          <Field label="Amount" htmlFor="amount" required>
            <Input id="amount" inputMode="decimal" className="font-mono tnum" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="Description" htmlFor="description" required>
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} placeholder={kind === "interest" ? "e.g. Bank interest for the year" : "e.g. Bank charges for the year"} />
          </Field>
        </div>

        {error && <Alert tone="exception" icon={AlertCircle} className="mt-3">{error}</Alert>}

        <div className="mt-5 flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Never mind</Button>
          <Button onClick={submit} loading={busy}>Record {money(amount || "0")}</Button>
        </div>
      </Card>
    </div>
  );
}