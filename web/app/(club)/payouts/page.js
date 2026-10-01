"use client";

/**
 * Payouts. Use Case 3, rotating clubs. REQ-64 to REQ-70, REQ-72, REQ-73.
 *
 * Built around the same two-account rule as everything else that moves money
 * out of the pool: the Treasurer proposes it, a different officer decides. The
 * preview at the top answers "what would happen if I initiated a payout right
 * now" without writing anything, the same way contribution capture answers
 * "what does this member owe" before any money changes hands.
 */

import { useEffect, useState, useCallback } from "react";
import { AlertCircle, Wallet, Check, X } from "lucide-react";
import { PageHeader } from "@/components/shell/ClubShell";
import Button from "@/components/ui/Button";
import { Card, Badge, Alert, Loading, Empty } from "@/components/ui/States";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useSession } from "@/lib/session";
import { payouts as api, ApiError } from "@/lib/api";
import { money, fmtDate, fmtDateTime } from "@/lib/format";

const STATUS_TONE = { Initiated: "attention", Approved: "positive", Cancelled: "neutral", Reversed: "neutral" };

export default function PayoutsPage() {
  const { club, can, membership } = useSession();
  const [preview, setPreview] = useState(null);
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(null);
  const [confirmation, setConfirmation] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const load = useCallback(async (signal) => {
    try {
      const [p, l] = await Promise.all([api.next({ signal }), api.list({ signal })]);
      setPreview(p.assessment);
      setList(l.payouts);
      setError(null);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Could not load payouts.");
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

  if (club?.clubType !== "Rotating") {
    return (
      <>
        <PageHeader title="Payouts" />
        <Card>
          <Empty icon={Wallet} title="Not applicable to this club">
            {club?.clubType === "Accumulating"
              ? "An accumulating club distributes the pool at year-end. See Distributions."
              : "A burial society pays out on an assessed claim. See Claims."}
          </Empty>
        </Card>
      </>
    );
  }

  if (error && !list) {
    return <Alert tone="exception" icon={AlertCircle} title="Could not load payouts">{error}</Alert>;
  }
  if (!list) return <Loading label="Loading payouts" />;

  const open = list.find((p) => p.status === "Initiated");

  return (
    <>
      <PageHeader
        title="Payouts"
        description="The member at the head of the queue is paid the contributions captured for the cycle, once its due date has passed."
      />

      {error && <Alert tone="exception" icon={AlertCircle} className="mb-5">{error}</Alert>}

      {open ? (
        <OpenPayout
          payout={open}
          myUserId={membership && open.initiated.userId}
          can={can}
          onApprove={() => setConfirmation({ title: "Approve payout", description: `Pay ${money(open.amount)} to ${open.recipient.fullName} and advance the queue?`, run: () => api.approve(open.payoutId) })}
          onCancel={() => setCancelling(open)}
          busy={busy}
        />
      ) : (
        <PreviewCard preview={preview} can={can} onInitiate={() => setConfirmation({ title: "Initiate payout", description: "Submit the assessed payout for approval by a different officer?", run: () => api.initiate() })} busy={busy} />
      )}

      <h2 className="text-sm font-semibold text-ink-900 mt-8 mb-3">History</h2>
      {list.length === 0 ? (
        <Card><Empty icon={Wallet} title="No payouts yet" /></Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px] border-collapse min-w-[640px]">
              <thead>
                <tr className="bg-canvas/70 border-b border-line text-ink-500 text-left">
                  <th scope="col" className="font-medium px-5 py-2.5">Recipient</th>
                  <th scope="col" className="font-medium py-2.5">Cycle</th>
                  <th scope="col" className="font-medium py-2.5 text-right">Amount</th>
                  <th scope="col" className="font-medium py-2.5">Status</th>
                  <th scope="col" className="font-medium px-5 py-2.5">Initiated</th>
                </tr>
              </thead>
              <tbody>
                {list.map((p) => (
                  <tr key={p.payoutId} className="border-b border-line last:border-0">
                    <td className="px-5 py-3 text-ink-900">{p.recipient.fullName}</td>
                    <td className="py-3 text-ink-500">{p.cycle ? `Cycle ${p.cycle.sequenceNumber}` : "—"}</td>
                    <td className="py-3 text-right font-mono tnum text-ink-900">{money(p.amount)}</td>
                    <td className="py-3"><Badge tone={STATUS_TONE[p.status]}>{p.status}</Badge></td>
                    <td className="px-5 py-3 text-ink-500 whitespace-nowrap">
                      {p.initiated.by}, {fmtDate(p.initiated.at)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {confirmation && <ConfirmDialog title={confirmation.title} description={confirmation.description}
        requireReason={false} confirmVariant="primary" onClose={() => setConfirmation(null)}
        onConfirm={async () => { await confirmation.run(); await load(); }} />}
      {cancelling && (
        <ConfirmDialog
          title="Cancel this payout"
          description={`${cancelling.recipient.fullName} will not be paid ${money(cancelling.amount)} unless a payout is initiated again.`}
          confirmLabel="Cancel the payout"
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => act(() => api.cancel(cancelling.payoutId, reason))}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function PreviewCard({ preview, can, onInitiate, busy }) {
  if (!preview) return <Loading label="Assessing the next payout" />;

  return (
    <Card>
      <div className="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Next payout</h2>
          {preview.head && <p className="text-[13px] text-ink-500 mt-0.5">Head of the queue: {preview.head.fullName}</p>}
        </div>
        <Badge tone={preview.eligible ? "positive" : "neutral"}>{preview.eligible ? "Ready" : "Not yet"}</Badge>
      </div>
      <div className="p-5">
        {preview.cycle && (
          <div className="grid sm:grid-cols-3 gap-4 mb-4">
            <Figure label="Cycle" value={`#${preview.cycle.sequenceNumber}`} />
            <Figure label="Amount" value={money(preview.cycle.capturedAmount)} />
            <Figure label="Pool after" value={money(preview.poolBalanceAfter)} />
          </div>
        )}

        {preview.notes?.map((n, i) => (
          <Alert key={i} tone="attention" className="mb-3">{n}</Alert>
        ))}

        {!preview.eligible && (
          <div className="space-y-2 mb-4">
            {preview.refusals.map((r, i) => (
              <Alert key={i} tone="exception" icon={AlertCircle}>{r.message}</Alert>
            ))}
          </div>
        )}

        {preview.eligible && can("payout.initiate") && (
          <Button onClick={onInitiate} loading={busy}>
            Initiate payout of {money(preview.cycle.capturedAmount)}
          </Button>
        )}
      </div>
    </Card>
  );
}

function Figure({ label, value }) {
  return (
    <div>
      <p className="text-[12.5px] text-ink-500">{label}</p>
      <p className="mt-1 font-mono tnum text-[17px] font-medium text-ink-900">{value}</p>
    </div>
  );
}

function OpenPayout({ payout, can, onApprove, onCancel, busy }) {
  return (
    <Card className="border-warn-600/25">
      <div className="px-5 py-4 border-b border-line flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">Waiting for approval</h2>
          <p className="text-[13px] text-ink-500 mt-0.5">
            Initiated by {payout.initiated.by}, {fmtDateTime(payout.initiated.at)}
          </p>
        </div>
        <Badge tone="attention">{payout.status}</Badge>
      </div>
      <div className="p-5">
        <div className="grid sm:grid-cols-3 gap-4 mb-4">
          <Figure label="Recipient" value={payout.recipient.fullName} />
          <Figure label="Amount" value={money(payout.amount)} />
          <Figure label="Cycle" value={payout.cycle ? `#${payout.cycle.sequenceNumber}` : "—"} />
        </div>

        {payout.assessmentNow && !payout.assessmentNow.eligible && (
          <div className="space-y-2 mb-4">
            {payout.assessmentNow.refusals.map((r, i) => (
              <Alert key={i} tone="exception" icon={AlertCircle} title="No longer eligible">{r.message}</Alert>
            ))}
          </div>
        )}

        <div className="flex gap-2">
          {can("payout.approve") && (
            <Button onClick={onApprove} loading={busy} variant="primary">
              <Check size={14} aria-hidden /> Approve
            </Button>
          )}
          {can("payout.cancel") && (
            <Button onClick={onCancel} variant="secondary" disabled={busy}>
              <X size={14} aria-hidden /> Cancel
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}