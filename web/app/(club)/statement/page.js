"use client";

/**
 * A member's statement. REQ-94.
 *
 * Set to be printed. A stokvel member asks for their statement at the annual
 * meeting and expects to be handed paper, so the page carries a proper heading
 * with the club name and the date it was drawn, the chrome is hidden by the
 * print stylesheet, and the running balance column survives Ctrl-P.
 *
 * Oldest first, deliberately: the club ledger runs newest-first because a
 * treasurer wants today at the top, but a person reading their own history
 * reads it forward.
 */

import { useEffect, useState } from "react";
import { AlertCircle, Printer, BookOpen } from "lucide-react";
import { PageHeader } from "@/components/shell/ClubShell";
import Button from "@/components/ui/Button";
import { Card, Badge, StandingBadge, Alert, Loading, Empty } from "@/components/ui/States";
import { ledger as api, ApiError } from "@/lib/api";
import { money, isZeroAmount, isNegativeAmount, fmtDate, fmtDateTime, cx } from "@/lib/format";

const TYPE_TONE = {
  Contribution: "positive",
  Penalty: "attention",
  Payout: "neutral",
  Claim: "neutral",
  Reversal: "exception",
  Adjustment: "attention"
};

export default function StatementPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const c = new AbortController();
    api
      .statement(null, { signal: c.signal })
      .then(setData)
      .catch((err) => {
        if (err.name === "AbortError") return;
        setError(err instanceof ApiError ? err.message : "Could not load your statement.");
      });
    return () => c.abort();
  }, []);

  if (error) {
    return <Alert tone="exception" icon={AlertCircle} title="Could not load your statement">{error}</Alert>;
  }
  if (!data) return <Loading label="Drawing your statement" />;

  const { member, club, lines, summary } = data;
  const owes = !isZeroAmount(summary.outstanding);

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="My statement"
          description="Every contribution, penalty and payout against your name, oldest first."
          action={
            <Button variant="secondary" onClick={() => window.print()}>
              <Printer size={15} aria-hidden />
              Print
            </Button>
          }
        />
      </div>

      {/* Printed heading. Hidden on screen, because the page already has one. */}
      <div className="hidden print:block mb-6">
        <h1 className="text-[20px] font-semibold">{club.name}</h1>
        <p className="text-[14px]">Statement of account — {member.fullName}</p>
        <p className="text-[12px] text-ink-500">Drawn {fmtDateTime(data.generatedAt)}</p>
      </div>

      <Card className="mb-5">
        <div className="px-5 py-4 border-b border-line flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-ink-900">{member.fullName}</h2>
            <p className="text-[12.5px] text-ink-500">
              {member.role} · joined {fmtDate(member.joinDate)}
              {member.queuePosition != null && ` · queue #${member.queuePosition}`}
            </p>
          </div>
          <StandingBadge standing={member.standing} />
        </div>

        <div className="grid sm:grid-cols-4 divide-y sm:divide-y-0 sm:divide-x divide-line">
          <Cell label="Paid in" value={money(summary.paidIn)} tone="positive" />
          <Cell label="Paid out" value={money(summary.paidOut)} />
          <Cell
            label="Net position"
            value={money(summary.netPosition)}
            tone={isNegativeAmount(summary.netPosition) ? "default" : "positive"}
            note={
              isNegativeAmount(summary.netPosition)
                ? "You have received more than you have paid in — a payout has come to you."
                : "What you have put in, less what you have taken out."
            }
          />
          <Cell
            label="Still owing"
            value={money(summary.outstanding)}
            tone={owes ? "exception" : "positive"}
            note={
              owes
                ? `Across ${summary.unpaidCycles} cycle${summary.unpaidCycles === 1 ? "" : "s"}.`
                : "You are fully paid up."
            }
          />
        </div>
      </Card>

      {(!isZeroAmount(member.creditAmount) || !isZeroAmount(summary.unsettledPenalties)) && (
        <div className="grid sm:grid-cols-2 gap-4 mb-5">
          {!isZeroAmount(member.creditAmount) && (
            <Alert tone="positive" title={`Credit of ${money(member.creditAmount)}`}>
              Carried from an overpayment. It will reduce your next contribution automatically.
            </Alert>
          )}
          {!isZeroAmount(summary.unsettledPenalties) && (
            <Alert tone="attention" title={`Unpaid penalties: ${money(summary.unsettledPenalties)}`}>
              Any amount you pay above your contribution goes to these first.
            </Alert>
          )}
        </div>
      )}

      {lines.length === 0 ? (
        <Card>
          <Empty icon={BookOpen} title="Nothing on your account yet">
            Entries appear here once your first contribution is captured.
          </Empty>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px] border-collapse min-w-[640px]">
              <caption className="sr-only">
                Statement of account for {member.fullName}, oldest entry first
              </caption>
              <thead>
                <tr className="bg-canvas/70 border-b border-line text-ink-500 text-left">
                  <th scope="col" className="font-medium px-5 py-2.5">Date</th>
                  <th scope="col" className="font-medium py-2.5">Entry</th>
                  <th scope="col" className="font-medium py-2.5">Type</th>
                  <th scope="col" className="font-medium py-2.5 text-right">Amount</th>
                  <th scope="col" className="font-medium px-5 py-2.5 text-right">Running total</th>
                </tr>
              </thead>
              <tbody>
                {lines.map((l) => (
                  <tr
                    key={l.entryId}
                    className={cx("border-b border-line last:border-0", l.isReversal && "bg-exc-50/40")}
                  >
                    <td className="px-5 py-2.5 text-ink-500 whitespace-nowrap font-mono tnum text-[12.5px]">
                      {fmtDate(l.postedAt)}
                    </td>
                    <td className="py-2.5 pr-3">
                      <p className="text-ink-900">{l.description}</p>
                      {l.reason && <p className="text-[12px] text-exc-700">Reason: {l.reason}</p>}
                    </td>
                    <td className="py-2.5">
                      <Badge tone={TYPE_TONE[l.entryType] || "neutral"}>{l.entryType}</Badge>
                    </td>
                    <td
                      className={cx(
                        "py-2.5 text-right font-mono tnum whitespace-nowrap",
                        isNegativeAmount(l.amount) ? "text-exc-700" : "text-ink-900"
                      )}
                    >
                      {money(l.amount, { sign: true })}
                    </td>
                    <td className="px-5 py-2.5 text-right font-mono tnum text-ink-500 whitespace-nowrap">
                      {money(l.runningTotal)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="mt-5 text-[13px] text-ink-500 leading-relaxed">
        The running total is your own position in this club, not the club&rsquo;s pool balance.
        Entries cannot be edited or removed — a correction appears as a further line that reverses
        the first.
      </p>
    </>
  );
}

function Cell({ label, value, note, tone = "default" }) {
  return (
    <div className="p-5">
      <p className="text-[13px] font-medium text-ink-500">{label}</p>
      <p
        className={cx(
          "mt-1.5 font-mono tnum text-[20px] leading-none font-medium",
          tone === "exception" ? "text-exc-700" : tone === "positive" ? "text-pos-700" : "text-ink-900"
        )}
      >
        {value}
      </p>
      {note && <p className="mt-2 text-[12px] text-ink-500 leading-relaxed">{note}</p>}
    </div>
  );
}