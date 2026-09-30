"use client";
import { useState } from "react";
import { ledger as api } from "@/lib/api";
import { money, fmtDateTime } from "@/lib/format";
import { useSession } from "@/lib/session";
import { Card, Badge, Alert } from "@/components/ui/States";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
export default function ReversalRequests({ requests, onChanged }) {
  const { can } = useSession();
  const [action, setAction] = useState(null);
  return (
    <section className="mb-6 space-y-3">
      <h2 className="font-semibold">Reversal requests</h2>
      <Alert tone="attention">
        A reversal corrects the ledger and pool balance. It does not undo a
        payout's queue turn, reopen a claim, or recalculate contribution
        allocations. The original records remain.
      </Alert>
      {!requests.length && (
        <p className="text-sm text-ink-500">No reversal requests.</p>
      )}
      {requests.map((r) => (
        <Card key={r.request_id} className="p-4 space-y-2">
          <div className="flex flex-wrap justify-between gap-2">
            <h3 className="font-medium">
              {r.entry_type} · original {money(r.amount)}
            </h3>
            <Badge>{r.status}</Badge>
          </div>
          <p className="text-sm break-words">{r.description}</p>
          <p className="text-sm break-words">Reason: {r.reason}</p>
          <p className="text-sm text-ink-500">
            Requested by {r.requested_by_name} · {fmtDateTime(r.requested_at)}
            {r.decided_by_name &&
              ` · ${r.status === "Rejected" ? "Rejected" : "Approved"} by ${r.decided_by_name}`}
          </p>
          {r.decision_reason && (
            <p className="text-sm">Decision reason: {r.decision_reason}</p>
          )}
          {r.status === "Pending" && can("ledger.reverseApprove") && (
            <div className="flex gap-2">
              <Button
                size="sm"
                onClick={() => setAction({ r, kind: "approve" })}
              >
                Approve reversal
              </Button>
              <Button
                size="sm"
                variant="secondary"
                onClick={() => setAction({ r, kind: "reject" })}
              >
                Reject
              </Button>
            </div>
          )}
          {r.status === "Approved" && can("ledger.reverse") && (
            <Button size="sm" onClick={() => setAction({ r, kind: "post" })}>
              Post approved reversal
            </Button>
          )}
        </Card>
      ))}
      {action && (
        <ConfirmDialog
          title={
            action.kind === "post"
              ? "Post approved reversal"
              : action.kind === "approve"
                ? "Approve payout reversal"
                : "Reject reversal"
          }
          description={`Original amount ${money(action.r.amount)}. Reason: ${action.r.reason}. ${action.kind === "approve" ? "Approval permits a Treasurer to post; it does not move money yet." : ""}`}
          requireReason={action.kind === "reject"}
          onClose={() => setAction(null)}
          onConfirm={async (reason) => {
            if (action.kind === "post")
              await api.postReversal(action.r.request_id);
            else
              await api.decideReversal(
                action.r.request_id,
                action.kind,
                reason,
              );
            await onChanged();
          }}
        />
      )}
    </section>
  );
}
