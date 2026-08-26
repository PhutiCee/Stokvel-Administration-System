"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowLeftRight, CheckCircle2, XCircle, AlertTriangle, Hourglass, ShieldCheck,
  ArrowRight, CalendarClock, Ban, Info
} from "lucide-react";
import { useSession, useData, useQuery } from "@/lib/data";
import { assessRotatingPayout } from "@/lib/rules";
import { money, fmtDate, fmtDateTime, cx } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Alert, EmptyState, SkeletonRows } from "@/components/ui/States";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Dialog from "@/components/ui/Dialog";
import Money from "@/components/patterns/Money";
import StatusBadge from "@/components/patterns/StatusBadge";
import PageHeader from "@/components/patterns/PageHeader";
import PrototypeNote from "@/components/patterns/Prototype";
import { useToast } from "@/components/ui/Toast";

export default function PayoutsPage() {
  const { club, role, userId, dispatch } = useSession();
  const d = useData();
  const router = useRouter();
  const toast = useToast();
  const [tab, setTab] = useState("queue");
  const [assessing, setAssessing] = useState(null);

  const { data, loading } = useQuery(() => {
    if (!club) return null;
    return {
      queue: d.queueFor(club.id),
      pool: d.poolBalance(club.id),
      constitution: d.constitutionFor(club.id),
      payouts: d.payoutsFor(club.id),
      pending: d.pendingPayouts(club.id),
      members: d.membersFor(club.id)
    };
  }, [club?.id]);

  if (!club) return null;
  const canInitiate = role === "Treasurer";
  const isRotating = club.type === "Rotating";

  function initiate(assessment, member) {
    dispatch({
      type: "INITIATE_PAYOUT",
      payload: {
        clubId: club.id, memberId: member.id, amount: assessment.amount,
        payoutType: "Rotation", initiatedBy: userId,
        eligibilityRule: assessment.ruleApplied,
        description: `Rotation payout to ${member.fullName}`,
        assessment: { checks: assessment.checks, resultingBalance: assessment.resultingBalance }
      }
    });
    setAssessing(null);
    toast.push({
      tone: "success",
      title: "Payout initiated, awaiting a second officer",
      description: `${money(assessment.amount)} to ${member.fullName}. Nothing is posted until the chairperson approves it.`
    });
    setTab("payouts");
  }

  return (
    <>
      <PageHeader
        title="Payouts"
        description={
          isRotating
            ? "The pool goes to one member each cycle, in the order the club agreed. The order cannot be jumped, and no payout is posted on one officer's say-so."
            : "Every payout is initiated by the treasurer and approved by a different officer before it reaches the ledger."
        }
        meta={
          <>
            <Badge tone="accent">Pool {money(data?.pool ?? 0)}</Badge>
            {data?.pending.length > 0 && <Badge tone="attention" icon={Hourglass}>{data.pending.length} awaiting approval</Badge>}
          </>
        }
      />

      <div className="flex gap-1 border-b border-line mb-5" role="tablist">
        {[["queue", isRotating ? "Payout queue" : "Members"], ["payouts", "Payout history"]].map(([k, label]) => (
          <button
            key={k} role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cx(
              "px-3.5 h-10 text-[13px] font-medium border-b-2 -mb-px transition-colors",
              tab === k ? "border-accent-600 text-accent-700" : "border-transparent text-ink-500 hover:text-ink-900"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {tab === "queue" ? (
        <Card>
          <CardHeader
            title={isRotating ? "Who receives next" : "Members"}
            description={isRotating ? `Established by ${data?.constitution.payoutOrderMethod.toLowerCase()} when the club was formed. It changes only when a payout is posted, or by an agreed swap.` : null}
          />
          {loading ? <SkeletonRows rows={6} cols={3} /> : data.queue.length === 0 ? (
            <EmptyState icon={ArrowLeftRight} title="No queue yet" description="A payout queue is established once members have been registered." />
          ) : (
            <ol className="divide-y divide-line">
              {data.queue.map((m, i) => {
                const head = i === 0;
                const projected = d.projectedDate(club.id, m);
                return (
                  <li key={m.id} className={cx("flex items-center gap-3 sm:gap-4 px-4 sm:px-5 py-3.5", head && "bg-accent-50/50")}>
                    <span className={cx(
                      "w-8 h-8 rounded-full grid place-items-center text-[13px] font-semibold tnum shrink-0",
                      head ? "bg-accent-600 text-white" : "bg-canvas border border-line text-ink-500"
                    )}>{m.queuePosition}</span>

                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link href={`/members/${m.id}`} className="text-[14px] font-medium text-ink-900 hover:text-accent-600 transition-colors truncate">
                          {m.fullName}
                        </Link>
                        {head && <Badge tone="accent">Next</Badge>}
                        {m.standing !== "Good standing" && <StatusBadge status={m.standing} />}
                      </div>
                      {projected && (
                        <p className="text-[12px] text-ink-500 mt-0.5 flex items-center gap-1.5">
                          <CalendarClock size={11} aria-hidden /> Around {fmtDate(projected)}
                        </p>
                      )}
                    </div>

                    <Button
                      size="sm" variant={head ? "primary" : "secondary"} disabled={!canInitiate}
                      onClick={() => setAssessing(m)}
                    >
                      Initiate
                    </Button>
                  </li>
                );
              })}
            </ol>
          )}
          {!canInitiate && (
            <div className="px-5 py-3.5 border-t border-line bg-canvas/60">
              <p className="text-[12px] text-ink-500">
                Initiation is the treasurer's action. {role === "Chairperson" && "Your part comes second: you approve what the treasurer initiates."}
              </p>
            </div>
          )}
        </Card>
      ) : (
        <Card>
          <CardHeader title="Payouts" description="Initiated, approved and cancelled, in one place" />
          {loading ? <SkeletonRows rows={4} cols={4} /> : data.payouts.length === 0 ? (
            <EmptyState
              icon={ArrowLeftRight}
              title="No payout has been initiated yet"
              description={isRotating ? "Open the queue tab and initiate a payout to the member at the head of it." : "Payouts appear here once a treasurer initiates one."}
            />
          ) : (
            <ul className="divide-y divide-line">
              {data.payouts.map((p) => {
                const m = data.members.find((x) => x.id === p.memberId);
                return (
                  <li key={p.id} className="px-4 sm:px-5 py-4 hover:bg-canvas/50 transition-colors">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[14px] font-medium text-ink-900">{m?.fullName}</p>
                          <StatusBadge status={p.status} />
                        </div>
                        <p className="text-[12px] text-ink-500 mt-1">{p.eligibilityRule}</p>
                        <p className="text-[12px] text-ink-400 mt-0.5">
                          Initiated by {d.userName(p.initiatedBy)} · {fmtDateTime(p.initiatedAt)}
                          {p.approvedBy && ` · approved by ${d.userName(p.approvedBy)}`}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        <Money value={p.amount} size="lg" />
                        {p.status === "Initiated" && (
                          <Button as={Link} href={`/payouts/${p.id}`} size="sm" className="mt-2 block">
                            Review <ArrowRight size={13} />
                          </Button>
                        )}
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      )}

      <PrototypeNote className="mt-5">
        Dual authorisation needs two people. Use the amber demo control in the header to switch to the
        chairperson's account after initiating, so you can see the approval side without a second browser.
      </PrototypeNote>

      {assessing && data && (
        <AssessmentDialog
          member={assessing} data={data} club={club}
          onClose={() => setAssessing(null)}
          onInitiate={initiate}
        />
      )}
    </>
  );
}

/**
 * The assessment is produced by the rules engine. Every line below is a ruling,
 * not a message written for the demo — which is why a refusal names the member who
 * is in fact next (REQ-72) and why arrears at the head of the queue offers the
 * chairperson two recorded options rather than a dead end (REQ-77).
 */
function AssessmentDialog({ member, data, club, onClose, onInitiate }) {
  const assessment = assessRotatingPayout({
    members: data.queue,
    targetMemberId: member.id,
    poolBalance: data.pool,
    constitution: { ...data.constitution, version: data.constitution.version }
  });

  const [busy, setBusy] = useState(false);
  const blocked = !assessment.eligible;

  return (
    <Dialog
      open onClose={onClose} size="lg"
      title={blocked ? "This payout cannot be initiated" : `Initiate a payout to ${member.fullName}`}
      description={blocked ? "The constitution does not permit it as things stand." : "Check the assessment, then send it to the chairperson for approval."}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>{blocked ? "Close" : "Cancel"}</Button>
          {!blocked && (
            <Button loading={busy} onClick={() => { setBusy(true); setTimeout(() => onInitiate(assessment, member), 340); }}>
              Initiate — awaits approval
            </Button>
          )}
        </>
      }
    >
      <div className="space-y-4">
        {blocked && (
          <Alert tone="exception" icon={XCircle} title={refusalTitle(assessment.refusal.code)}>
            {assessment.refusal.message}
          </Alert>
        )}

        {assessment.refusal?.fork && (
          <Alert tone="warning" icon={AlertTriangle} title="This is the chairperson's decision to make">
            <p>The member at the head of the queue is in arrears. The constitution does not let the queue simply
              move past them; the chairperson must choose, and whichever is chosen is recorded.</p>
            <ul className="mt-2 space-y-1">
              {assessment.refusal.fork.options.map((o) => (
                <li key={o} className="flex items-center gap-2 text-[13px]">
                  <span className="w-1 h-1 rounded-full bg-current opacity-50" aria-hidden />{o}
                </li>
              ))}
            </ul>
          </Alert>
        )}

        <div>
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400 mb-2">Eligibility assessment</p>
          <ul className="rounded-lg border border-line divide-y divide-line">
            {assessment.checks.map((c) => (
              <li key={c.id} className="flex items-start gap-3 px-4 py-3">
                {c.pass
                  ? <CheckCircle2 size={16} className="text-pos-600 shrink-0 mt-0.5" aria-hidden />
                  : <XCircle size={16} className="text-exc-600 shrink-0 mt-0.5" aria-hidden />}
                <div className="min-w-0">
                  <p className="text-[13px] font-medium text-ink-900">
                    {c.label} <span className="sr-only">{c.pass ? "passed" : "failed"}</span>
                  </p>
                  <p className="text-[12px] text-ink-500 mt-0.5 leading-relaxed">{c.detail}</p>
                </div>
              </li>
            ))}
          </ul>
        </div>

        {!blocked && (
          <dl className="rounded-lg border border-line divide-y divide-line bg-canvas/40">
            {[
              ["Recipient", member.fullName],
              ["Amount", money(assessment.amount)],
              ["Rule applied", assessment.ruleApplied],
              ["Pool after this payout", money(assessment.resultingBalance)]
            ].map(([k, v]) => (
              <div key={k} className="flex items-start justify-between gap-4 px-4 py-2.5">
                <dt className="text-[13px] text-ink-500 shrink-0">{k}</dt>
                <dd className="text-[13px] font-medium text-ink-900 text-right tnum">{v}</dd>
              </div>
            ))}
          </dl>
        )}

        <Alert tone="info" icon={ShieldCheck} title="Two officers, always">
          You are initiating. A different officer must approve before anything reaches the ledger, and the system
          will refuse an approval from this same account (REQ-64).
        </Alert>
      </div>
    </Dialog>
  );
}

function refusalTitle(code) {
  return {
    QUEUE: "It is not this member's turn",
    STANDING: "This member is not in good standing",
    FUNDS: "The pool is not big enough"
  }[code] || "Refused";
}
