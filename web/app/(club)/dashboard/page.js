"use client";

/**
 * The club dashboard.
 *
 * Ordered by who is looking at it. A member opens this to answer one question —
 * "am I up to date, and when is my turn" — so their own position comes first,
 * above the club totals. An officer gets the club figures underneath.
 *
 * Everything shown here is real, read from the ledger and the open cycle.
 * Nothing is a placeholder.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
import { AlertCircle, ArrowRight, TrendingUp, Users, CalendarClock, Scale } from "lucide-react";
import { PageHeader } from "@/components/shell/ClubShell";
import { Card, Badge, StandingBadge, Alert, Loading } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { clubs, ApiError } from "@/lib/api";
import { money, isZeroAmount, fmtDate, cx } from "@/lib/format";

/**
 * A single figure with its label and an optional note beneath.
 *
 * The figure is set in the mono face at a size that lets a column of them be
 * compared at a glance. The label is above it, not below: a person scanning
 * reads the label first to know what they are about to see.
 */
function Figure({ label, value, note, tone = "default", icon: Icon }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-500">{label}</p>
        {Icon && <Icon size={15} className="text-ink-400 shrink-0" aria-hidden />}
      </div>
      <p
        className={cx(
          "mt-2 font-mono tnum text-[24px] leading-none font-medium",
          tone === "exception" ? "text-exc-700" : tone === "positive" ? "text-pos-700" : "text-ink-900"
        )}
      >
        {value}
      </p>
      {note && <p className="mt-2 text-[12.5px] text-ink-500 leading-relaxed">{note}</p>}
    </Card>
  );
}

/** A proportion, shown as a bar rather than a percentage nobody can picture. */
function Progress({ done, total, label }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 mb-1.5">
        <span className="text-[13px] text-ink-700">{label}</span>
        <span className="text-[13px] font-mono tnum text-ink-500">
          {done} of {total}
        </span>
      </div>
      <div
        className="h-2 rounded-full bg-ink-900/8 overflow-hidden"
        role="progressbar"
        aria-valuenow={pct}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-label={label}
      >
        <div
          className={cx("h-full rounded-full transition-all", pct === 100 ? "bg-pos-600" : "bg-accent-600")}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export default function DashboardPage() {
  const { user, club, role, can } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const controller = new AbortController();
    clubs
      .summary({ signal: controller.signal })
      .then(setData)
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err instanceof ApiError ? err.message : "Could not load the dashboard.");
      });
    return () => controller.abort();
  }, []);

  if (error) {
    return (
      <Alert tone="exception" icon={AlertCircle} title="Could not load the dashboard">
        {error}
      </Alert>
    );
  }

  if (!data) return <Loading label="Loading the club" />;

  const { constitution, members, openCycle, poolBalance, own } = data;
  const owes = own && !isZeroAmount(own.outstanding);
  const firstName = user?.fullName?.split(" ")[0] || "";

  return (
    <>
      <PageHeader
        title={`Good day, ${firstName}`}
        description={
          own
            ? `You joined ${club.name} on ${fmtDate(own.joinDate)}.`
            : `You are viewing ${club.name}.`
        }
      />

      {/* The member's own position, first. */}
      {own && (
        <Card className="mb-8">
          <div className="px-5 py-4 border-b border-line flex items-center justify-between gap-3">
            <h2 className="text-sm font-semibold text-ink-900">Your position</h2>
            <StandingBadge standing={own.standing} />
          </div>

          <div className="grid sm:grid-cols-3 divide-y sm:divide-y-0 sm:divide-x divide-line">
            <div className="p-5">
              <p className="text-[13px] font-medium text-ink-500">You owe</p>
              <p
                className={cx(
                  "mt-2 font-mono tnum text-[24px] leading-none font-medium",
                  owes ? "text-exc-700" : "text-pos-700"
                )}
              >
                {money(own.outstanding)}
              </p>
              <p className="mt-2 text-[12.5px] text-ink-500">
                {owes ? "Across all open contributions." : "You are fully paid up."}
              </p>
            </div>

            {own.queuePosition != null && (
              <div className="p-5">
                <p className="text-[13px] font-medium text-ink-500">Your turn</p>
                <p className="mt-2 font-mono tnum text-[24px] leading-none font-medium text-ink-900">
                  {own.queuePosition === 1 ? "Next" : `#${own.queuePosition}`}
                </p>
                <p className="mt-2 text-[12.5px] text-ink-500">
                  {own.queuePosition === 1
                    ? "You are at the head of the rotation."
                    : `${own.queuePosition - 1} member${own.queuePosition === 2 ? "" : "s"} ahead of you.`}
                </p>
              </div>
            )}

            {!isZeroAmount(own.catchUpAmount) && (
              <div className="p-5">
                <p className="text-[13px] font-medium text-ink-500">Catch-up</p>
                <p className="mt-2 font-mono tnum text-[24px] leading-none font-medium text-warn-700">
                  {money(own.catchUpAmount)}
                </p>
                <p className="mt-2 text-[12.5px] text-ink-500">
                  Agreed when you joined part-way through a cycle.
                </p>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Club figures. */}
      <h2 className="text-sm font-semibold text-ink-900 mb-3">The club</h2>
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Figure
          label="Pool balance"
          value={money(poolBalance)}
          note={`Summed from ${data.ledgerEntryCount} ledger entries.`}
          icon={TrendingUp}
        />
        <Figure
          label="Members"
          value={String(members.total)}
          note={
            members.arrears > 0
              ? `${members.arrears} in arrears, ${members.good} in good standing.`
              : "All in good standing."
          }
          tone={members.arrears > 0 ? "exception" : "positive"}
          icon={Users}
        />
        {constitution && (
          <Figure
            label="Contribution"
            value={money(constitution.contributionAmount)}
            note={`${constitution.cycleFrequency}. Penalty ${money(constitution.penaltyAmount)} after ${constitution.gracePeriodDays} days.`}
            icon={Scale}
          />
        )}
        {openCycle && (
          <Figure
            label="Collected this cycle"
            value={money(openCycle.capturedTotal)}
            note={`of ${money(openCycle.expectedTotal)} expected. Due ${fmtDate(openCycle.dueDate)}.`}
            icon={CalendarClock}
          />
        )}
      </div>

      {openCycle && (
        <Card className="mt-4 p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-3 mb-4">
            <h3 className="text-sm font-semibold text-ink-900">
              Cycle {openCycle.sequenceNumber}
            </h3>
            <Badge tone="accent">Open</Badge>
          </div>
          <Progress
            done={openCycle.paidCount}
            total={openCycle.expectedCount}
            label="Members fully paid"
          />
          {can("contribution.capture") && (
            <Link
              href="/contributions"
              className="mt-4 inline-flex items-center gap-1.5 text-[13px] font-medium text-accent-600 hover:text-accent-700 rounded"
            >
              Capture a contribution
              <ArrowRight size={14} aria-hidden />
            </Link>
          )}
        </Card>
      )}

      <p className="mt-8 text-[13px] text-ink-500 leading-relaxed">
        Your role in this club is{" "}
        <strong className="font-medium text-ink-700">{role}</strong>, which decides what appears in
        the navigation above. Payouts, reconciliation and governance are still to come.
      </p>
    </>
  );
}