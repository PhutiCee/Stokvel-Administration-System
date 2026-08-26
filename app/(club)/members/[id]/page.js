"use client";

import Link from "next/link";
import { useParams, notFound } from "next/navigation";
import { ArrowLeft, Phone, Mail, Shield, CalendarDays, Users2, HeartHandshake } from "lucide-react";
import { useSession, useData } from "@/lib/data";
import { money, maskId, fmtDate, initials } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, THead, TH, TR, TD } from "@/components/ui/Table";
import { EmptyState } from "@/components/ui/States";
import Badge from "@/components/ui/Badge";
import Money from "@/components/patterns/Money";
import StatusBadge from "@/components/patterns/StatusBadge";
import PageHeader from "@/components/patterns/PageHeader";

export default function MemberDetailPage() {
  const { id } = useParams();
  const { club, role } = useSession();
  const d = useData();
  if (!club) return null;

  const member = d.membersFor(club.id).find((m) => m.id === id);
  if (!member) return notFound(); // REQ-14

  const balance = d.memberBalance(club.id, member.id);
  const statement = d.memberStatement(club.id, member.id).slice().reverse();
  const projected = d.projectedDate(club.id, member);
  const canRevealId = role === "Secretary";

  return (
    <>
      <Link href="/members" className="inline-flex items-center gap-1.5 text-[13px] text-ink-500 hover:text-ink-900 mb-4 transition-colors">
        <ArrowLeft size={14} aria-hidden /> Member register
      </Link>

      <PageHeader
        title={member.fullName}
        description={`Member of ${club.shortName} since ${fmtDate(member.joinDate)}${member.exitDate ? `, exited ${fmtDate(member.exitDate)}` : ""}.`}
        meta={
          <>
            <StatusBadge status={member.standing} />
            {member.role !== "Member" && <Badge tone="accent" icon={Shield}>{member.role}</Badge>}
            {member.queuePosition != null && <Badge tone="neutral">Queue position {member.queuePosition}</Badge>}
          </>
        }
      />

      <div className="grid lg:grid-cols-3 gap-5">
        <div className="lg:col-span-2 space-y-5">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            {[
              ["Paid in total", balance.paid, "plain"],
              ["Outstanding", balance.outstanding, balance.outstanding > 0 ? "exception" : "plain"],
              ["Penalties", balance.penalties, "plain"],
              ["Received", balance.received, "plain"]
            ].map(([label, value, tone]) => (
              <Card key={label} className="p-4">
                <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
                <p className="mt-1.5"><Money value={value} size="lg" tone={tone} /></p>
              </Card>
            ))}
          </div>

          <Card>
            <CardHeader title="Account history" description="Every entry affecting this member, most recent first" />
            {statement.length === 0 ? (
              <EmptyState title="Nothing recorded yet" description="Entries appear once a contribution is captured." />
            ) : (
              <Table>
                <THead>
                  <TR><TH>Date</TH><TH>Entry</TH><TH align="right">Amount</TH><TH align="right">Running</TH></TR>
                </THead>
                <tbody>
                  {statement.slice(0, 20).map((e) => {
                    const reversed = d.ledgerFor(club.id).some((x) => x.reversesId === e.id);
                    return (
                      <TR key={e.id}>
                        <TD className="tnum whitespace-nowrap text-[13px]">{fmtDate(e.postedAt)}</TD>
                        <TD>
                          <Badge tone={e.type === "Penalty" ? "attention" : e.type === "Reversal" ? "accent" : "neutral"}>{e.type}</Badge>
                          <p className={reversed ? "text-[12px] text-ink-400 line-through mt-1" : "text-[12px] text-ink-500 mt-1"}>{e.description}</p>
                          {e.reason && <p className="text-[12px] text-ink-500 italic mt-0.5">{e.reason}</p>}
                        </TD>
                        <TD align="right"><Money value={e.amount} size="sm" sign tone={e.amount > 0 ? "positive" : "plain"} /></TD>
                        <TD align="right"><Money value={e.running} size="sm" tone="muted" /></TD>
                      </TR>
                    );
                  })}
                </tbody>
              </Table>
            )}
          </Card>
        </div>

        <div className="space-y-5">
          <Card>
            <CardBody className="text-center border-b border-line pb-5">
              <span className="w-14 h-14 rounded-full bg-navy-950 text-white grid place-items-center text-base font-semibold mx-auto">
                {initials(member.fullName)}
              </span>
              <p className="text-[15px] font-semibold mt-3">{member.fullName}</p>
              <p className="text-[12px] text-ink-500 tnum mt-0.5">{maskId(member.idNumber, canRevealId)}</p>
              {!canRevealId && <p className="text-[11px] text-ink-400 mt-1">Identity numbers are masked except to the secretary</p>}
            </CardBody>
            <CardBody className="space-y-3">
              <Detail icon={Phone} label="Contact" value={member.phone} />
              <Detail icon={Mail} label="Email" value={member.email} />
              <Detail icon={CalendarDays} label="Joined" value={fmtDate(member.joinDate)} />
              {projected && <Detail icon={CalendarDays} label="Expected payout" value={fmtDate(projected)} />}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Next of kin" />
            <CardBody className="space-y-3">
              <Detail icon={Users2} label={member.nextOfKin?.relationship || "Relative"} value={member.nextOfKin?.name || "—"} />
              <Detail icon={Phone} label="Contact" value={member.nextOfKin?.phone || "—"} />
            </CardBody>
          </Card>

          {club.type === "Burial" && (
            <Card>
              <CardHeader title="Covered dependants" description="Only a recorded dependant attracts a benefit" />
              {member.dependants?.length ? (
                <ul className="divide-y divide-line">
                  {member.dependants.map((dep) => (
                    <li key={dep.id} className="px-5 py-3 flex items-center justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-[13px] text-ink-900 truncate">{dep.name}</p>
                        <p className="text-[12px] text-ink-500">Born {fmtDate(dep.dateOfBirth)}</p>
                      </div>
                      <Badge tone="neutral">{dep.category}</Badge>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState icon={HeartHandshake} title="No dependants recorded"
                  description="A benefit is payable only for a dependant recorded before the death occurred." />
              )}
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function Detail({ icon: Icon, label, value }) {
  return (
    <div className="flex items-start gap-2.5">
      <Icon size={14} className="text-ink-400 shrink-0 mt-0.5" aria-hidden />
      <div className="min-w-0">
        <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
        <p className="text-[13px] text-ink-900 mt-0.5 break-words">{value}</p>
      </div>
    </div>
  );
}
