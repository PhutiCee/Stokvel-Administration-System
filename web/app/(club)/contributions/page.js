"use client";

/**
 * Contributions. Use Case 2.
 *
 * The register for the open cycle, with capture in a panel beside it.
 *
 * The screen is built around what a treasurer actually does on a Sunday
 * afternoon: people come to her one at a time, she finds them in the list, takes
 * the money, records it. So the list is the page, search is at the top, and
 * capture happens next to the row rather than on another screen — she should
 * never lose sight of who she has already done.
 *
 * Outstanding and Late members sort to the top, because those are the people
 * still to be seen.
 */

import { useEffect, useState, useCallback, useMemo } from "react";
import {
  AlertCircle, Search, Check, CalendarPlus, Receipt, X, ArrowRight
} from "lucide-react";
import { PageHeader } from "@/components/shell/ClubShell";
import Button from "@/components/ui/Button";
import { Input, Select, Field } from "@/components/ui/Input";
import { Card, Badge, Alert, Loading, Empty } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { cycles as cyclesApi, contributions as api, ApiError } from "@/lib/api";
import { money, isZeroAmount, fmtDate, initials, cx } from "@/lib/format";

const METHODS = ["Cash", "Electronic funds transfer", "Other"];

const STATUS_TONE = {
  Paid: "positive",
  Partial: "attention",
  Outstanding: "neutral",
  Late: "exception"
};

/** Outstanding work first, then by name. */
const ORDER = { Late: 0, Outstanding: 1, Partial: 2, Paid: 3 };

export default function ContributionsPage() {
  const { can } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [opening, setOpening] = useState(false);

  const load = useCallback(async (signal) => {
    try {
      const d = await cyclesApi.current({ signal });
      setData(d);
      setError(null);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Could not load the cycle.");
    }
  }, []);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  const rows = useMemo(() => {
    if (!data?.contributions) return [];
    const q = query.trim().toLowerCase();
    return data.contributions
      .filter((c) => !q || c.fullName.toLowerCase().includes(q) || (c.phone || "").includes(q))
      .sort((a, b) => (ORDER[a.status] - ORDER[b.status]) || a.fullName.localeCompare(b.fullName));
  }, [data, query]);

  const totals = useMemo(() => {
    if (!data?.contributions) return null;
    const n = data.contributions.length;
    const paid = data.contributions.filter((c) => c.status === "Paid").length;
    return { n, paid, outstanding: n - paid };
  }, [data]);

  async function openNewCycle() {
    setOpening(true);
    setError(null);
    try {
      await cyclesApi.open({});
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setOpening(false);
    }
  }

  if (error && !data) {
    return <Alert tone="exception" icon={AlertCircle} title="Could not load contributions">{error}</Alert>;
  }
  if (!data) return <Loading label="Loading the cycle" />;

  // --- no open cycle -------------------------------------------------------
  if (!data.cycle) {
    return (
      <>
        <PageHeader title="Contributions" />
        <Card>
          <Empty
            icon={CalendarPlus}
            title="No cycle is open"
            action={
              can("cycle.open") && (
                <Button onClick={openNewCycle} loading={opening}>
                  Open a cycle
                </Button>
              )
            }
          >
            Opening a cycle bills every member in good standing the amount in the club&rsquo;s
            constitution. Anyone in arrears is left out, and any credit from an overpayment is
            applied automatically.
          </Empty>
        </Card>
        {error && <Alert tone="exception" icon={AlertCircle} className="mt-4">{error}</Alert>}
      </>
    );
  }

  const { cycle } = data;

  return (
    <>
      <PageHeader
        title={`Cycle ${cycle.sequenceNumber}`}
        description={
          `Due ${fmtDate(cycle.dueDate)}. ` +
          (cycle.gracePeriodDays > 0
            ? `Late from ${fmtDate(cycle.lateFrom)}, after ${cycle.gracePeriodDays} days of grace, when a ${money(cycle.penaltyAmount)} penalty is posted.`
            : `No grace period — a ${money(cycle.penaltyAmount)} penalty is posted the day after.`)
        }
        action={<Badge tone={cycle.status === "Open" ? "accent" : "neutral"}>{cycle.status}</Badge>}
      />

      {error && <Alert tone="exception" icon={AlertCircle} className="mb-5">{error}</Alert>}

      {receipt && <CaptureReceipt receipt={receipt} onDismiss={() => setReceipt(null)} />}

      {totals && totals.n > 1 && (
        <p className="text-[13px] text-ink-500 mb-4">
          {totals.paid} of {totals.n} paid in full.
          {totals.outstanding > 0 && ` ${totals.outstanding} still to collect.`}
        </p>
      )}

      <div className={cx("grid gap-5", selected ? "lg:grid-cols-[minmax(0,1fr)_360px]" : "")}>
        <div>
          {data.contributions.length > 3 && (
            <div className="relative mb-3">
              <Search
                size={15}
                className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400 pointer-events-none"
                aria-hidden
              />
              <Input
                type="search"
                placeholder="Find a member by name or number"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="pl-9"
                aria-label="Search members"
              />
            </div>
          )}

          {rows.length === 0 ? (
            <Card>
              <Empty icon={Receipt} title="Nobody matches that search" />
            </Card>
          ) : (
            <ul className="space-y-2">
              {rows.map((c) => {
                const short = !isZeroAmount(c.expected) && c.status !== "Paid";
                const active = selected?.contributionId === c.contributionId;
                return (
                  <li key={c.contributionId}>
                    <div
                      className={cx(
                        "bg-surface border rounded-lg shadow-card px-4 py-3 flex items-center gap-3 transition-colors",
                        active ? "border-accent-600 ring-1 ring-accent-600" : "border-line"
                      )}
                    >
                      <span
                        className="shrink-0 grid place-items-center w-9 h-9 rounded-full bg-navy-950 text-white text-[11px] font-semibold"
                        aria-hidden
                      >
                        {initials(c.fullName)}
                      </span>

                      <div className="min-w-0 flex-1">
                        <p className="text-[14px] font-medium text-ink-900 truncate">{c.fullName}</p>
                        <p className="text-[12.5px] text-ink-500 font-mono tnum">
                          {money(c.captured)} of {money(c.expected)}
                          {c.method ? ` · ${c.method}` : ""}
                        </p>
                      </div>

                      <Badge tone={STATUS_TONE[c.status]}>{c.status}</Badge>

                      {can("contribution.capture") && cycle.status === "Open" && (
                        <Button
                          size="sm"
                          variant={short ? "primary" : "secondary"}
                          onClick={() => {
                            setSelected(c);
                            setReceipt(null);
                          }}
                        >
                          {short ? "Capture" : "Add"}
                        </Button>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </div>

        {selected && (
          <CapturePanel
            key={selected.contributionId}
            contribution={selected}
            onCancel={() => setSelected(null)}
            onCaptured={async (result) => {
              setSelected(null);
              setReceipt(result);
              await load();
            }}
          />
        )}
      </div>
    </>
  );
}

// ---------------------------------------------------------------------------

function CapturePanel({ contribution, onCancel, onCaptured }) {
  const shortfall = Math.max(
    0,
    Math.round((Number(contribution.expected) - Number(contribution.captured)) * 100) / 100
  );

  const [amount, setAmount] = useState(shortfall > 0 ? String(shortfall.toFixed(2)) : "");
  const [method, setMethod] = useState("Cash");
  const [reference, setReference] = useState("");
  const [receiptDate, setReceiptDate] = useState(new Date().toISOString().slice(0, 10));
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const overpaying = Number(amount || 0) > shortfall && shortfall >= 0;

  async function submit() {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      const result = await api.capture(contribution.contributionId, {
        amount, method, reference: reference || null, receiptDate
      });
      onCaptured(result);
    } catch (err) {
      if (err instanceof ApiError && err.detail?.fields) setFields(err.detail.fields);
      else setError(err.message);
      setBusy(false);
    }
  }

  return (
    <Card className="p-5 h-fit lg:sticky lg:top-5">
      <div className="flex items-start justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-ink-900 truncate">{contribution.fullName}</h2>
          <p className="text-[12.5px] text-ink-500 font-mono tnum">
            Owes {money(shortfall)} of {money(contribution.expected)}
          </p>
        </div>
        <button
          onClick={onCancel}
          className="shrink-0 grid place-items-center w-7 h-7 rounded hover:bg-ink-900/5 text-ink-400"
          aria-label="Close"
        >
          <X size={15} />
        </button>
      </div>

      <div className="space-y-4">
        <Field label="Amount received" htmlFor="amount" required error={fields.amount}>
          <Input
            id="amount"
            inputMode="decimal"
            className="font-mono tnum text-[17px]"
            value={amount}
            onChange={(e) => {
              setAmount(e.target.value);
              setFields({});
            }}
            invalid={!!fields.amount}
            autoFocus
          />
        </Field>

        {overpaying && (
          <Alert tone="attention" title="More than is owed">
            The extra {money(Number(amount) - shortfall)} will go first to any unpaid penalty, then
            to older arrears oldest first, and whatever is left becomes a credit against the next
            cycle.
          </Alert>
        )}

        <Field label="Method" htmlFor="method" error={fields.method}>
          <Select
            id="method"
            value={method}
            onChange={(e) => {
              setMethod(e.target.value);
              setFields({});
            }}
          >
            {METHODS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
          </Select>
        </Field>

        {method === "Electronic funds transfer" && (
          <Field
            label="Transaction reference"
            htmlFor="reference"
            required
            error={fields.reference}
            hint="From the bank statement or the transfer confirmation."
          >
            <Input
              id="reference"
              className="font-mono"
              value={reference}
              onChange={(e) => {
                setReference(e.target.value);
                setFields({});
              }}
              invalid={!!fields.reference}
            />
          </Field>
        )}

        <Field label="Date received" htmlFor="receiptDate">
          <Input
            id="receiptDate"
            type="date"
            value={receiptDate}
            onChange={(e) => setReceiptDate(e.target.value)}
          />
        </Field>

        {error && <Alert tone="exception" icon={AlertCircle}>{error}</Alert>}

        <div className="flex gap-2 pt-1">
          <Button onClick={submit} loading={busy} className="flex-1">
            Capture {amount ? money(amount) : ""}
          </Button>
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            Cancel
          </Button>
        </div>
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------------------

/**
 * What happened, immediately after capture.
 *
 * The allocation breakdown matters: when a member hands over R2,000 they are
 * entitled to be told exactly which debts it answered, in order, before they
 * walk away.
 */
function CaptureReceipt({ receipt, onDismiss }) {
  return (
    <Card className="mb-5 border-pos-600/25 bg-pos-50/40">
      <div className="p-5">
        <div className="flex items-start gap-3">
          <span className="shrink-0 grid place-items-center w-8 h-8 rounded-full bg-pos-100 text-pos-700">
            <Check size={16} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[14px] font-medium text-ink-900">
              {money(receipt.amountReceived)} captured from {receipt.memberName}
            </p>
            <p className="text-[13px] text-ink-700 mt-0.5">
              This cycle is now <strong className="font-medium">{receipt.status}</strong> at{" "}
              <span className="font-mono tnum">{money(receipt.captured)}</span> of{" "}
              <span className="font-mono tnum">{money(receipt.expected)}</span>. Pool balance{" "}
              <span className="font-mono tnum">{money(receipt.ledger.resultingBalance)}</span>.
            </p>

            {receipt.penaltyLevied && (
              <p className="text-[13px] text-exc-700 mt-2">
                A late penalty of {money(receipt.penaltyLevied)} was posted automatically.
              </p>
            )}

            {receipt.allocations?.length > 0 && (
              <div className="mt-3">
                <p className="text-[12.5px] font-medium text-ink-700">
                  The extra {money(receipt.excess)} went to:
                </p>
                <ul className="mt-1.5 space-y-1">
                  {receipt.allocations.map((a, i) => (
                    <li key={i} className="flex items-baseline gap-2 text-[13px] text-ink-700">
                      <ArrowRight size={12} className="shrink-0 text-ink-400 mt-1" aria-hidden />
                      <span className="font-mono tnum">{money(a.amount)}</span>
                      <span className="text-ink-500">{a.description}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <button
            onClick={onDismiss}
            className="shrink-0 grid place-items-center w-7 h-7 rounded hover:bg-ink-900/5 text-ink-400"
            aria-label="Dismiss"
          >
            <X size={15} />
          </button>
        </div>
      </div>
    </Card>
  );
}