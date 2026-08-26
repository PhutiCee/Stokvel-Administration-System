"use client";

import Link from "next/link";
import {
  Wallet, TrendingUp, AlertTriangle, ShieldAlert, Clock,
  ArrowRight, HeartHandshake, CircleDollarSign, Hourglass, CalendarClock, Megaphone
} from "lucide-react";
import { useSession, useData, useQuery } from "@/lib/data";
import { money, fmtDate, relative, cx } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Alert, EmptyState, Skeleton, SkeletonRows } from "@/components/ui/States";
import StatCard from "@/components/patterns/StatCard";
import Money from "@/components/patterns/Money";
import StatusBadge from "@/components/patterns/StatusBadge";
import PageHeader from "@/components/patterns/PageHeader";
import MiniChart from "@/components/patterns/MiniChart";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import { Table, THead, TH, TR, TD } from "@/components/ui/Table";

export default function DashboardPage() {
  const { club, role, membership, user } = useSession();
  const d = useData();

  const { data, loading } = useQuery(() => {
    if (!club) return null;
    const pool = d.poolBalance(club.id);
    const cycle = d.openCycle(club.id);
    const cons = d.contributionsFor(club.id, cycle?.id);
    return {
      pool,
      cycle,
      constitution: d.constitutionFor(club.id),
      members: d.activeMembers(club.id),
      contributions: cons,
      outstanding: d.outstandingTotal(club.id),
      reconciliation: d.latestReconciliation(club.id),
      pending: d.pendingPayouts(club.id),
      claims: d.claimsFor(club.id).filter((c) => c.status === "Lodged"),
      queue: d.queueFor(club.id),
      series: d.monthlySeries(club.id),
      announcements: d.announcementsFor(club.id),
      ownBalance: membership ? d.memberBalance(club.id, membership.id) : null,
      ownProjected: membership ? d.projectedDate(club.id, membership) : null,
      arrears: d.activeMembers(club.id).filter((m) => m.standing === "In arrears")
    };
  }, [club?.id, membership?.id]);

  if (!club) return null;
  const isOfficer = role !== "Member";

  return (
    <>
      <PageHeader
        title={isOfficer ? `Good day, ${user.fullName.split(" ")[0]}` : "Your position"}
        description={
          isOfficer
            ? `${club.name}. Everything below is for this club only.`
            : `What you have paid, what you owe, and where you stand in ${club.shortName}.`
        }
        actions={
          role === "Treasurer" ? (
            <Button as={Link} href="/contributions"><Wallet size={15} /> Capture contributions</Button>
          ) : role === "Chairperson" && data?.pending.length ? (
            <Button as={Link} href="/payouts">Review {data.pending.length} approval{data.pending.length > 1 ? "s" : ""}</Button>
          ) : null
        }
      />

      {/* Exceptions first. REQ-116: anything requiring a human is separated from
          ordinary indicators and never left to be noticed inside a table. */}
      {!loading && isOfficer && <Exceptions data={data} role={role} />}

      {role === "Member" ? <MemberDashboard data={data} loading={loading} membership={membership} club={club} />
        : <OfficerDashboard data={data} loading={loading} role={role} club={club} d={d} />}
    </>
  );
}

function Exceptions({ data, role }) {
  const items = [];
  if (data?.reconciliation && data.reconciliation.status === "Exception") {
    items.push({
      key: "rec",
      title: "The pool does not agree with the bank",
      body: `A difference of ${money(Math.abs(data.reconciliation.difference))} as at ${fmtDate(data.reconciliation.asAtDate)}. It cannot be cleared without an explanatory entry.`,
      href: "/reconciliation", cta: "Investigate", icon: ShieldAlert
    });
  }
  if (data?.arrears.length) {
    items.push({
      key: "arrears",
      title: `${data.arrears.length} member${data.arrears.length > 1 ? "s are" : " is"} in arrears`,
      body: data.arrears.map((m) => m.fullName).join(", ") + ". A member in arrears may not receive money from the pool.",
      href: "/members", cta: "Open the register", icon: AlertTriangle
    });
  }
  if (role === "Chairperson" && data?.pending.length) {
    items.push({
      key: "approvals",
      title: `${data.pending.length} payout${data.pending.length > 1 ? "s are" : " is"} waiting for your approval`,
      body: "A payout does not move until a second officer approves it.",
      href: "/payouts", cta: "Review", icon: Hourglass
    });
  }
  if (data?.claims.length) {
    items.push({
      key: "claims",
      title: `${data.claims.length} burial claim${data.claims.length > 1 ? "s" : ""} awaiting assessment`,
      body: "Standing, cover and the waiting period are checked before any benefit is determined.",
      href: "/claims", cta: "Assess", icon: HeartHandshake
    });
  }
  if (!items.length) return null;

  return (
    <div className="space-y-2.5 mb-6">
      {items.map((i) => (
        <Alert key={i.key} tone={i.key === "rec" ? "exception" : "warning"} icon={i.icon} title={i.title}
          action={
            <Button as={Link} href={i.href} size="sm" variant="secondary" className="shrink-0 hidden sm:inline-flex">
              {i.cta} <ArrowRight size={13} />
            </Button>
          }
        >
          {i.body}
          <Link href={i.href} className="sm:hidden block mt-1.5 font-medium underline underline-offset-2">{i.cta}</Link>
        </Alert>
      ))}
    </div>
  );
}

function OfficerDashboard({ data, loading, role, club, d }) {
  const monthIn = data?.series?.[data.series.length - 1]?.income || 0;
  const monthOut = data?.series?.[data.series.length - 1]?.expenditure || 0;
  const paidCount = data?.contributions.filter((c) => c.status === "Paid").length || 0;
  const total = data?.contributions.length || 0;

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Pool balance" value={data?.pool} loading={loading} icon={CircleDollarSign}
          hint={data?.reconciliation?.status === "Exception" ? "Does not agree with the bank" : "Agrees with the last reconciliation"}
          tone={data?.reconciliation?.status === "Exception" ? "exception" : "plain"} href="/ledger" />
        <StatCard label="Captured this month" value={monthIn} loading={loading} icon={TrendingUp}
          hint={total ? `${paidCount} of ${total} members paid in full` : undefined} href="/contributions" />
        <StatCard label="Paid out this month" value={monthOut} loading={loading} icon={Wallet} href="/payouts" />
        <StatCard label="Outstanding from members" value={data?.outstanding} loading={loading} icon={Clock}
          tone={data?.outstanding > 0 ? "exception" : "plain"} href="/members" />
      </div>

      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
        <Card className="lg:col-span-2">
          <CardHeader title="Money in and out" description="The preceding twelve months (REQ-115)" />
          <CardBody>
            {loading ? <Skeleton className="h-40 w-full" /> : <MiniChart series={data.series} />}
          </CardBody>
        </Card>

        <Card>
          <CardHeader
            title={club.type === "Rotating" ? "Payout queue" : club.type === "Burial" ? "Recent claims" : "Members"}
            description={club.type === "Rotating" ? "Who is next, and who is not ready" : null}
            action={<Link href={club.type === "Burial" ? "/claims" : "/payouts"} className="text-[12px] font-medium text-accent-600 hover:text-accent-700">View all</Link>}
          />
          {loading ? <SkeletonRows rows={5} cols={2} /> : (
            <ul className="divide-y divide-line">
              {(club.type === "Rotating" ? data.queue.slice(0, 6) : data.members.slice(0, 6)).map((m, i) => (
                <li key={m.id} className="flex items-center gap-3 px-5 py-3">
                  <span className={cx(
                    "w-6 h-6 rounded-full grid place-items-center text-[11px] font-semibold tnum shrink-0",
                    i === 0 && club.type === "Rotating" ? "bg-accent-600 text-white" : "bg-canvas text-ink-500 border border-line"
                  )}>
                    {club.type === "Rotating" ? m.queuePosition : i + 1}
                  </span>
                  <span className="min-w-0 flex-1">
                    <Link href={`/members/${m.id}`} className="block text-[13px] text-ink-900 truncate hover:text-accent-600 transition-colors">
                      {m.fullName}
                    </Link>
                    {i === 0 && club.type === "Rotating" && <span className="text-[11px] text-accent-600 font-medium">Next to receive</span>}
                  </span>
                  {m.standing !== "Good standing" && <StatusBadge status={m.standing} />}
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      <div className="grid lg:grid-cols-3 gap-4 sm:gap-6">
        <Card className="lg:col-span-2">
          <CardHeader
            title={`This cycle — ${data?.cycle ? fmtDate(data.cycle.startDate) : ""}`}
            description={data?.cycle ? `Due ${fmtDate(data.cycle.dueDate)}, grace ${data.constitution.gracePeriodDays} days` : null}
            action={<Link href="/contributions" className="text-[12px] font-medium text-accent-600 hover:text-accent-700">Capture</Link>}
          />
          {loading ? <SkeletonRows rows={4} cols={3} /> : (
            <Table>
              <THead>
                <TR><TH>Member</TH><TH align="right">Expected</TH><TH align="right">Captured</TH><TH>Status</TH></TR>
              </THead>
              <tbody>
                {data.contributions
                  .slice()
                  .sort((a, b) => (a.status === "Paid" ? 1 : 0) - (b.status === "Paid" ? 1 : 0))
                  .slice(0, 6)
                  .map((c) => {
                    const m = data.members.find((x) => x.id === c.memberId);
                    return (
                      <TR key={c.id} className="hover:bg-canvas/70">
                        <TD className="text-ink-900">{m?.fullName || "—"}</TD>
                        <TD align="right"><Money value={c.expectedAmount} tone="muted" size="sm" /></TD>
                        <TD align="right"><Money value={c.capturedAmount} size="sm" /></TD>
                        <TD><StatusBadge status={c.status} /></TD>
                      </TR>
                    );
                  })}
              </tbody>
            </Table>
          )}
        </Card>

        <Card>
          <CardHeader title="Notices" description="Published to every member" />
          {loading ? <SkeletonRows rows={2} cols={1} /> : data.announcements.length === 0 ? (
            <EmptyState icon={Megaphone} title="No notices yet" description="Officers publish notices here; they cannot be edited afterwards." />
          ) : (
            <ul className="divide-y divide-line">
              {data.announcements.slice(0, 3).map((a) => (
                <li key={a.id} className="px-5 py-3.5">
                  <p className="text-[13px] font-medium text-ink-900">{a.subject}</p>
                  <p className="text-[12px] text-ink-500 mt-1 line-clamp-2 leading-relaxed">{a.body}</p>
                  <p className="text-[11px] text-ink-400 mt-1.5">{relative(a.publishedAt)}</p>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function MemberDashboard({ data, loading, membership, club }) {
  const bal = data?.ownBalance;
  const owes = bal?.outstanding > 0;

  return (
    <div className="space-y-6">
      {/* The member's single most important question, answered before anything else. */}
      <Card className={cx("overflow-hidden", owes ? "border-warn-600/30" : "border-pos-600/30")}>
        <div className={cx("px-5 py-6 sm:px-7 sm:py-7", owes ? "bg-warn-50" : "bg-pos-50")}>
          <p className={cx("text-[13px] font-medium", owes ? "text-warn-700" : "text-pos-700")}>
            {owes ? "You still owe" : "You are up to date"}
          </p>
          {loading ? <Skeleton className="h-9 w-40 mt-2" /> : (
            <p className="mt-1.5">
              <Money value={owes ? bal.outstanding : bal.paid} size="xxl" tone={owes ? "exception" : "positive"} />
            </p>
          )}
          <p className={cx("text-[13px] mt-2 leading-relaxed max-w-md", owes ? "text-warn-700/90" : "text-pos-700/90")}>
            {owes
              ? "Pay your treasurer and ask them to capture it. A penalty is added once the grace period passes."
              : `You have paid ${money(bal?.paid || 0)} into ${club.shortName} in total. Nothing is outstanding.`}
          </p>
        </div>
        <CardBody className="grid grid-cols-2 sm:grid-cols-4 gap-4">
          <Metric label="Paid in total" value={money(bal?.paid || 0)} loading={loading} />
          <Metric label="Penalties" value={money(bal?.penalties || 0)} loading={loading} />
          <Metric label="Received from the pool" value={money(bal?.received || 0)} loading={loading} />
          <Metric label="Standing" value={<StatusBadge status={membership.standing} />} loading={loading} raw />
        </CardBody>
      </Card>

      <div className="grid sm:grid-cols-2 gap-4 sm:gap-6">
        {club.type === "Rotating" && membership.queuePosition != null && (
          <Card>
            <CardHeader title="Your turn to receive" description="Position in the payout queue (REQ-78)" />
            <CardBody>
              {loading ? <Skeleton className="h-16 w-full" /> : (
                <div className="flex items-center gap-4">
                  <span className="w-14 h-14 rounded-xl bg-navy-950 text-white grid place-items-center shrink-0">
                    <span className="text-xl font-semibold tnum">{membership.queuePosition}</span>
                  </span>
                  <div className="min-w-0">
                    <p className="text-sm text-ink-900">
                      {membership.queuePosition === 1
                        ? "You are next to receive the pool."
                        : `There ${membership.queuePosition - 1 === 1 ? "is" : "are"} ${membership.queuePosition - 1} member${membership.queuePosition - 1 === 1 ? "" : "s"} ahead of you.`}
                    </p>
                    {data.ownProjected && (
                      <p className="text-[13px] text-ink-500 mt-1 flex items-center gap-1.5">
                        <CalendarClock size={13} aria-hidden /> Expected around {fmtDate(data.ownProjected)}
                      </p>
                    )}
                    <p className="text-[12px] text-ink-400 mt-2 leading-relaxed">
                      The order can only change if you agree to a swap and the chairperson approves it.
                    </p>
                  </div>
                </div>
              )}
            </CardBody>
          </Card>
        )}

        <Card>
          <CardHeader title={`${club.shortName}'s pool`} description="What the club holds in total (REQ-95)" />
          <CardBody>
            {loading ? <Skeleton className="h-10 w-32" /> : (
              <>
                <Money value={data.pool} size="xl" />
                <p className="text-[12px] text-ink-500 mt-2 leading-relaxed">
                  As at {fmtDate(new Date())}. Every member sees the same figure, taken from the ledger rather
                  than from anyone's word.
                </p>
                <Button as={Link} href="/statement" variant="secondary" size="sm" className="mt-4">
                  See my statement <ArrowRight size={13} />
                </Button>
              </>
            )}
          </CardBody>
        </Card>
      </div>

      <Card>
        <CardHeader title="Notices from your officers" />
        {loading ? <SkeletonRows rows={2} cols={1} /> : data.announcements.length === 0 ? (
          <EmptyState icon={Megaphone} title="Nothing posted yet" description="Meeting notices and rule changes will appear here." />
        ) : (
          <ul className="divide-y divide-line">
            {data.announcements.map((a) => (
              <li key={a.id} className="px-5 py-4">
                <p className="text-sm font-medium text-ink-900">{a.subject}</p>
                <p className="text-[13px] text-ink-500 mt-1 leading-relaxed">{a.body}</p>
                <p className="text-[11px] text-ink-400 mt-2">{relative(a.publishedAt)}</p>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

function Metric({ label, value, loading, raw }) {
  return (
    <div>
      <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
      {loading ? <Skeleton className="h-5 w-20 mt-1.5" />
        : raw ? <div className="mt-1.5">{value}</div>
          : <p className="text-sm font-medium tnum text-ink-900 mt-1.5">{value}</p>}
    </div>
  );
}
