"use client";

import { useState } from "react";
import Link from "next/link";
import { useParams, useRouter, notFound } from "next/navigation";
import { CheckCircle2, XCircle, ShieldAlert, ArrowLeft, Ban, ShieldCheck } from "lucide-react";
import { useSession, useData } from "@/lib/data";
import { canApprovePayout } from "@/lib/rules";
import { money, fmtDateTime } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Alert } from "@/components/ui/States";
import { Textarea, Field } from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Dialog from "@/components/ui/Dialog";
import Money from "@/components/patterns/Money";
import StatusBadge from "@/components/patterns/StatusBadge";
import PageHeader from "@/components/patterns/PageHeader";
import { useToast } from "@/components/ui/Toast";

export default function PayoutDetailPage() {
  const { id } = useParams();
  const router = useRouter();
  const toast = useToast();
  const { club, role, userId, dispatch } = useSession();
  const d = useData();
  const [confirm, setConfirm] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);

  if (!club) return null;
  const payout = d.state.payouts.find((p) => p.id === id && p.clubId === club.id);
  // REQ-14: a payout belonging to another club is simply not found.
  if (!payout) return notFound();

  const member = d.membersFor(club.id).find((m) => m.id === payout.memberId);
  const verdict = canApprovePayout({ payout, actor: { role, userId } });
  const pool = d.poolBalance(club.id);

  function approve() {
    setBusy(true);
    setTimeout(() => {
      dispatch({ type: "APPROVE_PAYOUT", payload: { id: payout.id, actorId: userId } });
      setBusy(false); setConfirm(false);
      toast.push({
        tone: "success",
        title: "Payout approved and posted",
        description: `${money(payout.amount)} to ${member.fullName}. The ledger and the queue have both moved.`
      });
      router.push("/ledger");
    }, 420);
  }

  function cancel() {
    dispatch({ type: "CANCEL_PAYOUT", payload: { id: payout.id, reason } });
    setCancelling(false);
    toast.push({ tone: "info", title: "Initiation cancelled", description: "The queue is unaffected and nothing was posted." });
    router.push("/payouts");
  }

  return (
    <>
      <Link href="/payouts" className="inline-flex items-center gap-1.5 text-[13px] text-ink-500 hover:text-ink-900 mb-4 transition-colors">
        <ArrowLeft size={14} aria-hidden /> All payouts
      </Link>

      <PageHeader
        title={payout.status === "Initiated" ? "Approve this payout?" : "Payout"}
        description={
          payout.status === "Initiated"
            ? "This is what you are being asked to authorise, and the rule it rests on (REQ-65)."
            : `This payout is ${payout.status.toLowerCase()}.`
        }
        meta={<StatusBadge status={payout.status} />}
      />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <Card>
            <CardBody className="text-center py-8 border-b border-line">
              <p className="text-[13px] text-ink-500">Amount to be paid to</p>
              <p className="text-lg font-semibold text-ink-900 mt-1">{member?.fullName}</p>
              <p className="mt-3"><Money value={payout.amount} size="xxl" /></p>
              <p className="text-[13px] text-ink-500 mt-3">
                Pool is {money(pool)} now, and would be {money(pool - payout.amount)} afterwards
              </p>
            </CardBody>

            <div className="p-5">
              <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400 mb-2">The assessment it rests on</p>
              <ul className="rounded-lg border border-line divide-y divide-line">
                {(payout.assessment?.checks || []).map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                    {c.pass
                      ? <CheckCircle2 size={16} className="text-pos-600 shrink-0 mt-0.5" aria-hidden />
                      : <XCircle size={16} className="text-exc-600 shrink-0 mt-0.5" aria-hidden />}
                    <div>
                      <p className="text-[13px] font-medium text-ink-900">{c.label}</p>
                      <p className="text-[12px] text-ink-500 mt-0.5">{c.detail}</p>
                    </div>
                  </li>
                ))}
              </ul>
              <p className="text-[12px] text-ink-500 mt-3">Rule applied: {payout.eligibilityRule}</p>
            </div>
          </Card>

          {payout.status === "Initiated" && (
            <Card>
              <CardHeader title="Your decision" />
              <CardBody className="space-y-4">
                {!verdict.allowed && (
                  <Alert tone={verdict.code === "SAME_ACCOUNT" ? "exception" : "warning"} icon={ShieldAlert}
                    title={verdict.code === "SAME_ACCOUNT" ? "You cannot approve your own initiation" : "Not your action"}>
                    {verdict.reason}
                    {verdict.code === "SAME_ACCOUNT" && (
                      <p className="mt-1.5 opacity-90">
                        This is the single control that stops one person moving money out of the pool alone.
                        Switch to the chairperson's account using the amber demo control in the header to continue.
                      </p>
                    )}
                  </Alert>
                )}

                <div className="flex flex-col sm:flex-row gap-2">
                  <Button disabled={!verdict.allowed} onClick={() => setConfirm(true)} className="sm:flex-1">
                    <ShieldCheck size={15} /> Approve and post
                  </Button>
                  <Button variant="secondary" onClick={() => setCancelling(true)}
                    disabled={role !== "Treasurer" || payout.initiatedBy !== userId}>
                    <Ban size={15} /> Cancel the initiation
                  </Button>
                </div>
                <p className="text-[12px] text-ink-500">
                  Cancelling is the initiating treasurer's own action, and it leaves the queue untouched (REQ-70).
                </p>
              </CardBody>
            </Card>
          )}
        </div>

        <Card className="h-fit">
          <CardHeader title="Trail" description="Who did what, and when (REQ-68)" />
          <CardBody className="space-y-4">
            <TrailItem label="Initiated by" name={d.userName(payout.initiatedBy)} at={payout.initiatedAt} />
            {payout.approvedAt && <TrailItem label="Approved by" name={d.userName(payout.approvedBy)} at={payout.approvedAt} />}
            {payout.cancelledAt && <TrailItem label="Cancelled" name={payout.cancelReason || "No reason recorded"} at={payout.cancelledAt} />}
            {payout.status === "Initiated" && (
              <div className="flex gap-3">
                <span className="w-2 h-2 rounded-full bg-warn-600 mt-1.5 shrink-0" aria-hidden />
                <div>
                  <p className="text-[13px] font-medium text-ink-900">Awaiting a second officer</p>
                  <p className="text-[12px] text-ink-500 mt-0.5">Nothing has been posted to the ledger.</p>
                </div>
              </div>
            )}
          </CardBody>
        </Card>
      </div>

      <Dialog
        open={confirm} onClose={() => setConfirm(false)}
        title="Post this payout to the ledger?"
        description="This is the last step. Once posted it cannot be edited or deleted."
        footer={
          <>
            <Button variant="secondary" onClick={() => setConfirm(false)}>Back</Button>
            <Button loading={busy} onClick={approve}>Yes, post {money(payout.amount)}</Button>
          </>
        }
      >
        <div className="space-y-3">
          <dl className="rounded-lg border border-line divide-y divide-line">
            {[["Recipient", member?.fullName], ["Amount", money(payout.amount)],
              ["Pool afterwards", money(pool - payout.amount)],
              ["Queue effect", "The recipient moves to the end and everyone else advances by one"]].map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-[13px] text-ink-500 shrink-0">{k}</dt>
                <dd className="text-[13px] font-medium text-ink-900 text-right">{v}</dd>
              </div>
            ))}
          </dl>
          <Alert tone="warning">
            An error afterwards is corrected by a reversing entry, which stays visible next to the original.
          </Alert>
        </div>
      </Dialog>

      <Dialog
        open={cancelling} onClose={() => setCancelling(false)}
        title="Cancel this initiation?"
        description="The queue is unaffected and nothing is posted. The cancellation and its reason are recorded."
        footer={
          <>
            <Button variant="secondary" onClick={() => setCancelling(false)}>Keep it</Button>
            <Button variant="danger" disabled={reason.trim().length < 5} onClick={cancel}>Cancel the payout</Button>
          </>
        }
      >
        <Field label="Reason" htmlFor="cancel-reason" required hint="Recorded against the payout. At least a few words.">
          <Textarea id="cancel-reason" value={reason} onChange={(e) => setReason(e.target.value)}
            placeholder="The member asked to defer to next month." data-autofocus />
        </Field>
      </Dialog>
    </>
  );
}

function TrailItem({ label, name, at }) {
  return (
    <div className="flex gap-3">
      <span className="w-2 h-2 rounded-full bg-pos-600 mt-1.5 shrink-0" aria-hidden />
      <div className="min-w-0">
        <p className="text-[13px] font-medium text-ink-900">{label} {name}</p>
        <p className="text-[12px] text-ink-500 mt-0.5">{fmtDateTime(at)}</p>
      </div>
    </div>
  );
}
