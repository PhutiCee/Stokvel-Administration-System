"use client";
import { useState } from "react";
import { governance } from "@/lib/api";
import { money } from "@/lib/format";
import Button from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Card, CardBody, Alert } from "@/components/ui/States";
export default function AnnualReport() {
  const current = Number(
    new Intl.DateTimeFormat("en", {
      timeZone: "Africa/Johannesburg",
      year: "numeric",
    }).format(new Date()),
  );
  const [year, setYear] = useState(current),
    [data, setData] = useState(null),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function load(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setData(null);
    try {
      setData(await governance.annualReport(year));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Card>
      <CardBody>
        <details>
          <summary className="text-sm font-semibold cursor-pointer">
            Annual club report
          </summary>
          <form onSubmit={load} className="flex flex-wrap gap-3 items-end mt-4">
            <Field label="Reporting year" htmlFor="report-year">
              <Input
                id="report-year"
                type="number"
                min="1900"
                max={current}
                required
                value={year}
                onChange={(e) => setYear(e.target.value)}
              />
            </Field>
            <Button type="submit" variant="secondary" loading={busy}>
              Generate report
            </Button>
          </form>
          {error && (
            <Alert tone="exception" className="mt-3">
              {error}
            </Alert>
          )}
          {data && (
            <section className="mt-4 space-y-4">
              <h2 className="font-semibold">
                {data.year} ·{" "}
                {data.completeYear ? "Annual report" : "Year-to-date report"}
              </h2>
              <p className="text-sm text-ink-500">
                {data.start} to {data.asAt}, South African calendar dates.
                Financial totals are net of reversing entries.
              </p>
              <dl className="grid sm:grid-cols-2 gap-3">
                {[
                  ["opening_balance", "Opening pool balance"],
                  ["contributions", "Net contributions"],
                  ["penalties", "Net penalties"],
                  ["payouts", "Net payouts and claims"],
                  ["other_movements", "Other net movements"],
                  ["closing_balance", "Closing pool balance"],
                ].map(([key, label]) => (
                  <div key={key} className="p-3 border border-line rounded">
                    <dt className="text-sm text-ink-500">{label}</dt>
                    <dd className="font-mono font-semibold">
                      {money(data[key])}
                    </dd>
                  </div>
                ))}
              </dl>
              <h3 className="text-sm font-semibold">Membership movement</h3>
              <p className="text-sm">
                Opening: {data.membership.opening} · Joined:{" "}
                {data.membership.joined} · Ended: {data.membership.ended} ·
                Closing: {data.membership.closing}
              </p>
              {data.membership.undatedEnds > 0 && (
                <Alert tone="attention">
                  {data.membership.undatedEnds} ended memberships have no exit
                  date and are excluded from the movement counts. Their
                  historical movement cannot be verified.
                </Alert>
              )}
              <h3 className="text-sm font-semibold">Reconciliation position</h3>
              {!data.reconciliation ? (
                <Alert tone="attention">
                  No reconciliation was recorded on or before the report
                  cut-off. The bank position is unverified.
                </Alert>
              ) : (
                <div className="space-y-2 text-sm">
                  <p>
                    Latest recorded position: {data.reconciliation.date} · Bank:{" "}
                    {money(data.reconciliation.bankBalance)} · Ledger at
                    reconciliation: {money(data.reconciliation.ledgerBalance)} ·
                    Difference: {money(data.reconciliation.difference)}
                  </p>
                  {data.reconciliation.date !== data.asAt && (
                    <Alert tone="attention">
                      This reconciliation predates the report cut-off and does
                      not verify the bank balance at {data.asAt}.
                    </Alert>
                  )}
                  {Number(data.reconciliation.difference) !== 0 && (
                    <Alert tone="attention">
                      A non-zero difference is recorded. Explanation:{" "}
                      {data.reconciliation.note || "No explanation recorded."}
                    </Alert>
                  )}
                </div>
              )}
            </section>
          )}
        </details>
      </CardBody>
    </Card>
  );
}
