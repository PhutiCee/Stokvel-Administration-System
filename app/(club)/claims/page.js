"use client";

import { useState } from "react";
import { HeartHandshake, CheckCircle2, XCircle, FileText, Info, ShieldCheck, Clock } from "lucide-react";
import { useSession, useData, useQuery } from "@/lib/data";
import { assessBurialClaim } from "@/lib/rules";
import { money, fmtDate, relative, cx } from "@/lib/format";
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

export default function ClaimsPage() {
  const { club, role, userId, dispatch } = useSession();
  const d = useData();
  const toast = useToast();
  const [open, setOpen] = useState(null);

  const { data, loading } = useQuery(() => {
    if (!club) return null;
    return {
      claims: d.claimsFor(club.id),
      members: d.membersFor(club.id),
      constitution: d.constitutionFor(club.id),
      pool: d.poolBalance(club.id)
    };
  }, [club?.id]);

  if (!club) return null;
  if (club.type !== "Burial") {
    return (
      <>
        <PageHeader title="Burial claims" />
        <Card><EmptyState icon={HeartHandshake} title="Not applicable to this club"
          description={`${club.shortName} is a ${club.type.toLowerCase()} club. Burial benefits apply only to burial societies.`} /></Card>
      </>
    );
  }

  const canAssess = role === "Treasurer" || role === "Chairperson";

  return (
    <>
      <PageHeader
        title="Burial claims"
        description="A benefit is paid when a recorded dependant of a member in good standing dies, once the waiting period has passed. Nothing is assessed by hand."
        meta={
          <>
            <Badge tone="accent">Pool {money(data?.pool ?? 0)}</Badge>
            {data?.claims.filter((c) => c.status === "Lodged").length > 0 && (
              <Badge tone="attention" icon={Clock}>{data.claims.filter((c) => c.status === "Lodged").length} awaiting assessment</Badge>
            )}
          </>
        }
      />

      <Alert tone="neutral" icon={Info} className="mb-5" title="Claims are assessed in the order they were lodged">
        Where the pool cannot meet every valid claim, no claim is paid in part. The shortfall goes to the
        chairperson to resolve (REQ-88).
      </Alert>

      {loading ? <Card><SkeletonRows rows={3} cols={3} /></Card> : data.claims.length === 0 ? (
        <Card><EmptyState icon={HeartHandshake} title="No claims lodged"
          description="When a member loses a covered dependant, their claim appears here for assessment." /></Card>
      ) : (
        <div className="space-y-4">
          {data.claims.map((claim) => {
            const claimant = data.members.find((m) => m.id === claim.claimantId);
            const dependant = claimant?.dependants?.find((x) => x.id === claim.dependantId);
            const assessment = claimant ? assessBurialClaim({
              member: claimant, dependant, dateOfDeath: claim.dateOfDeath,
              constitution: data.constitution, poolBalance: data.pool
            }) : null;

            return (
              <Card key={claim.id}>
                <div className="px-5 py-4 flex flex-col sm:flex-row sm:items-start justify-between gap-4 border-b border-line">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <h2 className="text-[15px] font-semibold text-ink-900">{dependant?.name || "Unrecorded person"}</h2>
                      <StatusBadge status={claim.status === "Paid" ? "Approved" : claim.status} />
                      {dependant && <Badge tone="neutral">{dependant.category}</Badge>}
                    </div>
                    <p className="text-[13px] text-ink-500 mt-1">
                      Claimed by {claimant?.fullName} · died {fmtDate(claim.dateOfDeath)} · lodged {relative(claim.lodgedAt)}
                    </p>
                    {claim.note && <p className="text-[13px] text-ink-700 mt-2 italic leading-relaxed">“{claim.note}”</p>}
                  </div>
                  <div className="text-right shrink-0">
                    {assessment?.eligible
                      ? <Money value={assessment.amount} size="lg" />
                      : <span className="text-[13px] text-ink-400">No benefit determined</span>}
                    <p className="text-[11px] text-ink-400 mt-1 flex items-center gap-1 justify-end">
                      <FileText size={11} aria-hidden /> {claim.supportingDocument}
                    </p>
                  </div>
                </div>

                <CardBody>
                  <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400 mb-2">Assessment</p>
                  <ul className="rounded-lg border border-line divide-y divide-line">
                    {assessment?.checks.map((c) => (
                      <li key={c.id} className="flex items-start gap-3 px-4 py-2.5">
                        {c.pass
                          ? <CheckCircle2 size={15} className="text-pos-600 shrink-0 mt-0.5" aria-hidden />
                          : <XCircle size={15} className="text-exc-600 shrink-0 mt-0.5" aria-hidden />}
                        <div className="min-w-0">
                          <p className="text-[13px] font-medium text-ink-900">{c.label}</p>
                          <p className="text-[12px] text-ink-500 mt-0.5 leading-relaxed">{c.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ul>

                  {claim.status === "Lodged" && (
                    <div className="mt-4">
                      {assessment?.eligible ? (
                        <>
                          <Alert tone="positive" icon={ShieldCheck} title={`${money(assessment.amount)} is payable`}>
                            {assessment.ruleApplied}. The pool would be {money(assessment.resultingBalance)} afterwards.
                            Like every payout, it still needs two officers.
                          </Alert>
                          <Button className="mt-3" disabled={!canAssess} onClick={() => setOpen({ claim, claimant, assessment })}>
                            Initiate the benefit payout
                          </Button>
                        </>
                      ) : (
                        <>
                          <Alert tone="exception" icon={XCircle} title="This claim cannot be paid">
                            {assessment?.refusal.message}
                            <span className="block mt-1.5 opacity-90">
                              A refusal is recorded with its reason, and the claimant is told which check failed and why.
                            </span>
                          </Alert>
                          <Button variant="secondary" className="mt-3" disabled={!canAssess}
                            onClick={() => {
                              dispatch({ type: "ASSESS_CLAIM", payload: { id: claim.id, status: "Refused", actorId: userId, refusalReason: assessment.refusal.message } });
                              toast.push({ tone: "info", title: "Claim refused", description: "The reason has been recorded against the claim." });
                            }}>
                            Record the refusal
                          </Button>
                        </>
                      )}
                    </div>
                  )}

                  {claim.status === "Refused" && claim.refusalReason && (
                    <Alert tone="neutral" className="mt-4" title="Refused">{claim.refusalReason}</Alert>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}

      <PrototypeNote className="mt-5">
        The SRS defines a payout as Initiated, Approved or Cancelled, with no Refused state, yet Use Case 4
        requires a refused claim to be recorded with its reason. The prototype adds a Refused state on the claim
        itself. This is a genuine gap in the specification, not an invention.
      </PrototypeNote>

      {open && (
        <Dialog
          open onClose={() => setOpen(null)} size="lg"
          title="Initiate the burial benefit"
          description="It goes to the chairperson for approval, exactly like any other payout."
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(null)}>Cancel</Button>
              <Button onClick={() => {
                dispatch({
                  type: "INITIATE_PAYOUT",
                  payload: {
                    clubId: club.id, memberId: open.claimant.id, amount: open.assessment.amount,
                    payoutType: "Burial claim", initiatedBy: userId, claimId: open.claim.id,
                    eligibilityRule: open.assessment.ruleApplied,
                    description: `Burial benefit — ${open.claim.dependantId}`,
                    assessment: { checks: open.assessment.checks, resultingBalance: open.assessment.resultingBalance }
                  }
                });
                dispatch({ type: "ASSESS_CLAIM", payload: { id: open.claim.id, status: "Assessed", actorId: userId } });
                setOpen(null);
                toast.push({ tone: "success", title: "Benefit initiated", description: "Awaiting the chairperson's approval." });
              }}>Initiate — awaits approval</Button>
            </>
          }
        >
          <dl className="rounded-lg border border-line divide-y divide-line">
            {[
              ["Paid to", open.claimant.fullName],
              ["Benefit tier", open.assessment.tier?.category],
              ["Amount", money(open.assessment.amount)],
              ["Pool afterwards", money(open.assessment.resultingBalance)]
            ].map(([k, v]) => (
              <div key={k} className="flex items-center justify-between gap-4 px-4 py-2.5">
                <dt className="text-[13px] text-ink-500">{k}</dt>
                <dd className="text-[13px] font-medium text-ink-900 tnum text-right">{v}</dd>
              </div>
            ))}
          </dl>
        </Dialog>
      )}
    </>
  );
}
