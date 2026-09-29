"use client";

/**
 * Payout queue. Use Case 3, rotating clubs. REQ-71 to REQ-78.
 *
 * Every member sees the whole order — it is the shared timetable of who is
 * paid when, and hiding it would invite exactly the suspicion the rotation
 * exists to remove. Open exchanges are the exception: a member sees their
 * own, and an officer sees everyone's.
 */

import { useEffect, useState, useCallback } from "react";
import { AlertCircle, ListOrdered, ArrowLeftRight, Check, X, Shuffle } from "lucide-react";
import { PageHeader } from "@/components/shell/ClubShell";
import Button from "@/components/ui/Button";
import { Card, Badge, StandingBadge, Alert, Loading, Empty } from "@/components/ui/States";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useSession } from "@/lib/session";
import { queue as api, ApiError } from "@/lib/api";
import { fmtDate, initials, cx } from "@/lib/format";

export default function QueuePage() {
  const { club, can, membership } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [requesting, setRequesting] = useState(false);
  const [ruling, setRuling] = useState(null);
  const [rejecting, setRejecting] = useState(null);

  const load = useCallback(async (signal) => {
    try {
      setData(await api.get({ signal }));
      setError(null);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Could not load the queue.");
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
        <PageHeader title="Payout queue" />
        <Card>
          <Empty icon={ListOrdered} title="Not applicable to this club">
            Only a rotating club pays members in turn.
          </Empty>
        </Card>
      </>
    );
  }

  if (error && !data) {
    return <Alert tone="exception" icon={AlertCircle} title="Could not load the queue">{error}</Alert>;
  }
  if (!data) return <Loading label="Loading the queue" />;

  if (!data.entries.length) {
    return (
      <>
        <PageHeader
          title="Payout queue"
          action={
            can("queue.establish") && (
              <Button onClick={() => act(() => api.establish())} loading={busy}>
                <Shuffle size={14} aria-hidden /> Establish the order
              </Button>
            )
          }
        />
        {error && <Alert tone="exception" icon={AlertCircle} className="mb-4">{error}</Alert>}
        <Card>
          <Empty icon={ListOrdered} title="The queue has not been set">
            {data.payoutOrderMethod
              ? `Set by ${data.payoutOrderMethod}, drawn from the constitution.`
              : "The constitution does not yet name a payout order method."}
          </Empty>
        </Card>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Payout queue"
        description={`Order set by ${data.payoutOrderMethod || "the constitution"}. Advances one place each time a payout is posted.`}
      />

      {error && <Alert tone="exception" icon={AlertCircle} className="mb-5">{error}</Alert>}

      {data.needsRuling && can("queue.resolveArrears") && (
        <Alert tone="attention" icon={AlertCircle} title="A ruling is needed" className="mb-5">
          <p>
            {data.needsRuling.fullName} is at the head of the queue and {data.needsRuling.standing.toLowerCase()}.
            The queue cannot advance past them until this is resolved.
          </p>
          <div className="flex gap-2 mt-3">
            <Button size="sm" onClick={() => setRuling({ member: data.needsRuling, decision: "defer" })}>
              Defer to the end
            </Button>
            {data.needsRuling.options.includes("pay") && (
              <Button size="sm" variant="secondary" onClick={() => setRuling({ member: data.needsRuling, decision: "pay" })}>
                Pay notwithstanding arrears
              </Button>
            )}
          </div>
        </Alert>
      )}

      <Card className="overflow-hidden mb-6">
        <ol>
          {data.entries.map((e, i) => (
            <li
              key={e.memberId}
              className={cx(
                "flex items-center gap-3 px-5 py-3 border-b border-line last:border-0",
                e.isYou && "bg-accent-50/50"
              )}
            >
              <span
                className={cx(
                  "shrink-0 grid place-items-center w-7 h-7 rounded-full text-[12px] font-semibold",
                  i === 0 ? "bg-accent-600 text-white" : "bg-ink-900/5 text-ink-500"
                )}
              >
                {e.position}
              </span>
              <span className="shrink-0 grid place-items-center w-8 h-8 rounded-full bg-navy-950 text-white text-[11px] font-semibold" aria-hidden>
                {initials(e.fullName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-[14px] text-ink-900 truncate">
                  {e.fullName} {e.isYou && <span className="text-ink-500 font-normal">(you)</span>}
                </p>
                {e.projectedDate && <p className="text-[12.5px] text-ink-500">Projected {fmtDate(e.projectedDate)}</p>}
              </div>
              <StandingBadge standing={e.standing} />
              {can("queue.requestSwap") && membership && e.memberId !== membership.memberId && (
                <Button size="sm" variant="ghost" onClick={() => setRequesting(e)}>
                  <ArrowLeftRight size={13} aria-hidden /> Exchange
                </Button>
              )}
            </li>
          ))}
        </ol>
      </Card>

      <h2 className="text-sm font-semibold text-ink-900 mb-3">Exchanges of position</h2>
      {!data.openSwaps.length ? (
        <p className="text-[13px] text-ink-500">No exchange is currently pending.</p>
      ) : (
        <div className="space-y-3">
          {data.openSwaps.map((s) => (
            <SwapCard
              key={s.swapId}
              swap={s}
              membership={membership}
              can={can}
              busy={busy}
              onConsent={(consent) => act(() => api.consentToSwap(s.swapId, consent))}
              onApprove={() => act(() => api.approveSwap(s.swapId))}
              onReject={() => setRejecting(s)}
              onCancel={() => act(() => api.cancelSwap(s.swapId))}
            />
          ))}
        </div>
      )}

      {requesting && (
        <RequestSwapDialog
          withMember={requesting}
          onClose={() => setRequesting(null)}
          onConfirm={() => act(() => api.requestSwap(requesting.memberId))}
        />
      )}

      {ruling && (
        <ConfirmDialog
          title={ruling.decision === "defer" ? `Defer ${ruling.member.fullName}` : `Pay ${ruling.member.fullName} notwithstanding arrears`}
          description={
            ruling.decision === "defer"
              ? `${ruling.member.fullName} moves to the end of the queue. The next member becomes head.`
              : `${ruling.member.fullName} is paid as normal despite being in arrears. Nothing about the order changes.`
          }
          confirmLabel="Confirm ruling"
          confirmVariant="primary"
          onClose={() => setRuling(null)}
          onConfirm={(reason) => act(() => api.resolveArrears(ruling.member.memberId, ruling.decision, reason))}
        />
      )}

      {rejecting && (
        <ConfirmDialog
          title="Refuse this exchange"
          description={`${rejecting.requester.fullName} and ${rejecting.counterparty.fullName} will keep their current positions.`}
          confirmLabel="Refuse the exchange"
          onClose={() => setRejecting(null)}
          onConfirm={(reason) => act(() => api.rejectSwap(rejecting.swapId, reason))}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

const SWAP_STATUS_TONE = { "Pending consent": "attention", "Pending approval": "accent" };

function SwapCard({ swap, membership, can, busy, onConsent, onApprove, onReject, onCancel }) {
  const isCounterparty = membership && swap.counterparty.memberId === membership.memberId;
  const isRequester = membership && swap.requester.memberId === membership.memberId;

  return (
    <Card className="p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[14px] text-ink-900">
            {swap.requester.fullName} <ArrowLeftRight size={12} className="inline mx-1 text-ink-400" aria-hidden />{" "}
            {swap.counterparty.fullName}
          </p>
          <p className="text-[12.5px] text-ink-500 mt-0.5">
            Positions {swap.requester.positionAtRequest} and {swap.counterparty.positionAtRequest}
          </p>
        </div>
        <Badge tone={SWAP_STATUS_TONE[swap.status] || "neutral"}>{swap.status}</Badge>
      </div>

      <div className="flex gap-2 mt-3">
        {swap.status === "Pending consent" && isCounterparty && (
          <>
            <Button size="sm" onClick={() => onConsent(true)} loading={busy}>
              <Check size={13} aria-hidden /> Consent
            </Button>
            <Button size="sm" variant="secondary" onClick={() => onConsent(false)} disabled={busy}>
              <X size={13} aria-hidden /> Decline
            </Button>
          </>
        )}
        {swap.status === "Pending approval" && can("queue.approveSwap") && (
          <>
            <Button size="sm" onClick={onApprove} loading={busy}>
              <Check size={13} aria-hidden /> Approve
            </Button>
            <Button size="sm" variant="secondary" onClick={onReject} disabled={busy}>
              Refuse
            </Button>
          </>
        )}
        {["Pending consent", "Pending approval"].includes(swap.status) && isRequester && (
          <Button size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
            Withdraw
          </Button>
        )}
      </div>
    </Card>
  );
}

function RequestSwapDialog({ withMember, onClose, onConfirm }) {
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm();
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-5" role="dialog" aria-modal="true" aria-label="Request an exchange">
      <Card className="w-full max-w-md p-5 shadow-pop animate-slideUp">
        <h2 className="text-sm font-semibold text-ink-900">Exchange places with {withMember.fullName}</h2>
        <p className="mt-1.5 text-[13px] text-ink-500 leading-relaxed">
          They will be asked to consent. If they do, the Chairperson still has to approve it before your
          positions actually change.
        </p>
        {error && <Alert tone="exception" icon={AlertCircle} className="mt-3">{error}</Alert>}
        <div className="mt-5 flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Never mind</Button>
          <Button onClick={submit} loading={busy}>Ask to exchange</Button>
        </div>
      </Card>
    </div>
  );
}