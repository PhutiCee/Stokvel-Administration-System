"use client";

import { ScrollText, History, Info, CheckCircle2, AlertTriangle } from "lucide-react";
import { useSession, useData, useQuery } from "@/lib/data";
import { validateConstitution } from "@/lib/rules";
import { money, fmtDate } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Alert, SkeletonRows } from "@/components/ui/States";
import Badge from "@/components/ui/Badge";
import PageHeader from "@/components/patterns/PageHeader";
import PrototypeNote from "@/components/patterns/Prototype";

export default function ConstitutionPage() {
  const { club } = useSession();
  const d = useData();

  const { data, loading } = useQuery(() => {
    if (!club) return null;
    const current = d.constitutionFor(club.id);
    const versions = d.state.constitutions
      .filter((c) => c.clubId === club.id)
      .sort((a, b) => b.version - a.version);
    return { current, versions, validity: validateConstitution(current) };
  }, [club?.id]);

  if (!club) return null;

  const rules = data ? [
    { label: "Club type", value: club.type, note: "Decides which payout rules apply." },
    { label: "Contribution", value: `${money(data.current.contributionAmount)} ${data.current.cycleFrequency.toLowerCase()}`, note: "What every member owes each cycle." },
    { label: "Grace period", value: `${data.current.gracePeriodDays} days`, note: "How long after the due date before a contribution is late." },
    { label: "Late penalty", value: money(data.current.penaltyAmount), note: "Charged once per member per cycle, automatically." },
    { label: "Quorum", value: `${data.current.quorumPercentage}% of active members`, note: "Below this, resolutions are advisory only and have no effect." },
    { label: "Notice to exit", value: `${data.current.exitNoticeDays} days`, note: "Before a member may leave the club." },
    ...(club.type === "Rotating" ? [{ label: "Payout order", value: data.current.payoutOrderMethod, note: "How the queue was first established. It cannot be jumped." }] : []),
    ...(club.type === "Burial" ? [{ label: "Waiting period", value: `${data.current.waitingPeriodDays} days`, note: "From joining, before a claim may be lodged." }] : [])
  ] : [];

  return (
    <>
      <PageHeader
        title="Constitution"
        description="Your club's rules, as the system applies them. These are not settings buried in a menu; they are the rules themselves, and everything the system decides comes from here."
        meta={
          <>
            <Badge tone="accent">Version {data?.current.version}</Badge>
            <Badge tone="neutral">In force since {data ? fmtDate(data.current.effectiveDate) : "—"}</Badge>
          </>
        }
      />

      {loading ? <Card><SkeletonRows rows={6} cols={2} /></Card> : (
        <div className="grid lg:grid-cols-3 gap-5">
          <div className="lg:col-span-2 space-y-5">
            <Card>
              <CardHeader title="The rules in force" description="Applied automatically to every contribution, penalty and payout" />
              <ul className="divide-y divide-line">
                {rules.map((r) => (
                  <li key={r.label} className="px-5 py-4 flex flex-col sm:flex-row sm:items-baseline gap-1 sm:gap-6">
                    <span className="text-[13px] text-ink-500 sm:w-40 shrink-0">{r.label}</span>
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium text-ink-900 tnum">{r.value}</span>
                      <span className="block text-[12px] text-ink-500 mt-0.5 leading-relaxed">{r.note}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>

            {club.type === "Burial" && (
              <Card>
                <CardHeader title="Benefit schedule" description="What is paid, depending on who has died" />
                <ul className="divide-y divide-line">
                  {data.current.benefitSchedule.map((b) => (
                    <li key={b.category} className="px-5 py-3.5 flex items-center justify-between gap-4">
                      <span className="text-[14px] text-ink-900">{b.category}</span>
                      <span className="text-[14px] font-medium tnum text-ink-900">{money(b.amount)}</span>
                    </li>
                  ))}
                </ul>
              </Card>
            )}

            <Card>
              <CardHeader title="Forfeiture on exit" />
              <CardBody>
                <p className="text-[14px] text-ink-700 leading-relaxed">{data.current.forfeitureRule}</p>
              </CardBody>
            </Card>
          </div>

          <div className="space-y-5">
            <Card>
              <CardHeader title="Consistency check" description="Run before any version takes effect (REQ-29)" />
              <CardBody>
                {data.validity.valid ? (
                  <div className="flex items-start gap-2.5">
                    <CheckCircle2 size={16} className="text-pos-600 shrink-0 mt-0.5" aria-hidden />
                    <p className="text-[13px] text-ink-700 leading-relaxed">
                      These rules are internally consistent. The grace period fits inside the cycle, the quorum is
                      within range, and the contribution is above zero.
                    </p>
                  </div>
                ) : (
                  <Alert tone="exception" icon={AlertTriangle} title="This constitution is inconsistent">
                    <ul className="mt-1 space-y-1">{data.validity.errors.map((e) => <li key={e}>{e}</li>)}</ul>
                  </Alert>
                )}
              </CardBody>
            </Card>

            <Card>
              <CardHeader title="Version history" description="Prior versions are kept, never overwritten" />
              <ul className="divide-y divide-line">
                {data.versions.map((v) => (
                  <li key={v.id} className="px-5 py-3.5">
                    <div className="flex items-center gap-2">
                      <History size={13} className="text-ink-400" aria-hidden />
                      <span className="text-[13px] font-medium text-ink-900">Version {v.version}</span>
                      {v.version === data.current.version && <Badge tone="accent">In force</Badge>}
                    </div>
                    <p className="text-[12px] text-ink-500 mt-1 tnum">From {fmtDate(v.effectiveDate)}</p>
                    <p className="text-[12px] text-ink-500 mt-1 leading-relaxed">
                      Penalty {money(v.penaltyAmount)} · grace {v.gracePeriodDays} days · quorum {v.quorumPercentage}%
                    </p>
                  </li>
                ))}
              </ul>
            </Card>

            <Alert tone="info" icon={Info} title="Why old versions matter">
              A transaction is judged by the rules in force on the day it happened, not by today's rules. When
              this club raised its penalty, nothing already closed was recomputed (REQ-31, REQ-33).
            </Alert>
          </div>
        </div>
      )}

      <PrototypeNote className="mt-5">
        Amending a constitution requires a resolution carried at a quorate meeting (REQ-32). The governance
        screens that record meetings, attendance and votes are designed but deferred past this prototype, so this
        screen is read-only for now.
      </PrototypeNote>
    </>
  );
}
