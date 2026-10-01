"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { money, fmtDate, fmtDateTime } from "@/lib/format";
function Rows({ rows }) {
  if (!rows.length) return <p className="my-2">No matching records.</p>;
  const keys = Object.keys(rows[0]).filter(
    (k) =>
      !k.endsWith("_id") &&
      k !== "member_id" &&
      k !== "payload" &&
      k !== "body",
  );
  return (
    <div className="overflow-x-auto my-3">
      <table className="w-full text-sm">
        <thead>
          <tr>
            {keys.map((k) => (
              <th key={k} className="text-left p-2">
                {k.replaceAll("_", " ")}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((r, i) => (
            <tr key={i}>
              {keys.map((k) => (
                <td key={k} className="p-2 border-t border-line">
                  {r[k] == null
                    ? "—"
                    : typeof r[k] === "object"
                      ? JSON.stringify(r[k])
                      : String(r[k])}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
function Trend({ months }) {
  const values = months.flatMap((m) => [
      Number(m.income),
      Number(m.expenditure),
    ]),
    low = Math.min(0, ...values),
    high = Math.max(1, ...values),
    span = high - low;
  const y = (v) => 130 - ((Number(v) - low) / span) * 110;
  const points = (key) =>
    months.map((m, i) => `${30 + i * 44},${y(m[key])}`).join(" ");
  return (
    <figure className="my-4">
      <svg
        viewBox="0 0 550 165"
        role="img"
        aria-label="Income and expenditure over the previous twelve completed months. Exact figures and source records are listed below."
      >
        <line x1="25" x2="525" y1={y(0)} y2={y(0)} stroke="#94a3b8" />
        <polyline
          points={points("income")}
          fill="none"
          stroke="#166534"
          strokeWidth="3"
        />
        <polyline
          points={points("expenditure")}
          fill="none"
          stroke="#b45309"
          strokeWidth="3"
        />
        {months.map((m, i) => (
          <text
            key={m.month}
            x={30 + i * 44}
            y="154"
            textAnchor="middle"
            fontSize="9"
          >
            {m.month.slice(2)}
          </text>
        ))}
      </svg>
      <figcaption className="text-sm">
        Green: income · Amber: expenditure. Exact values below; ledger reversals
        may create negative months.
      </figcaption>
    </figure>
  );
}
export default function DashboardDetails() {
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  useEffect(() => {
    const c = new AbortController();
    api
      .get("/api/dashboard", { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, []);
  if (error) return <p role="alert">{error}</p>;
  if (!data) return <p>Loading financial details…</p>;
  return (
    <section className="mt-6">
      <h2 className="font-semibold mb-2">Financial detail</h2>
      <p className="text-sm mb-4">
        Snapshot: {fmtDateTime(data.asOf)}. Open a figure to inspect its source
        records.
      </p>
      {data.position.inQueue && (
        <p className="my-3">
          Queue position: {data.position.position} of {data.position.of}.
          Projected payout:{" "}
          {data.position.projectedDate
            ? fmtDate(data.position.projectedDate)
            : "Not scheduled"}
          .{" "}
          <a href="/queue" className="underline">
            View queue
          </a>
        </p>
      )}
      <div className="space-y-3">
        {data.indicators.map((m) => (
          <details
            key={m.key}
            className={`border rounded p-4 ${m.key === "overdue" && m.value > 0 ? "border-red-400 bg-red-50" : "border-line"}`}
          >
            <summary className="cursor-pointer">
              {m.label}:{" "}
              <strong>
                {m.value === null
                  ? "Not recorded"
                  : m.kind === "money"
                    ? money(m.value)
                    : m.value}
              </strong>
            </summary>
            <Rows rows={m.records} />
          </details>
        ))}
      </div>
      {data.reconciliationMissing && (
        <p className="my-3">No reconciliation has been recorded.</p>
      )}
      {data.reconciliationException && (
        <p role="alert" className="my-3 text-red-800">
          The latest reconciliation has a non-zero difference.
        </p>
      )}
      {data.months.length > 0 && (
        <div className="my-6">
          <h3 className="font-semibold">Previous 12 completed months</h3>
          <Trend months={data.months} />
          {data.months.map((m) => (
            <details key={m.month} className="border-b border-line py-3">
              <summary>
                {m.month} · Income {money(m.income)} · Expenditure{" "}
                {money(m.expenditure)}
              </summary>
              <Rows rows={m.records} />
            </details>
          ))}
        </div>
      )}
      {data.limitations.map((t) => (
        <p key={t} className="text-sm my-3">
          {t}
        </p>
      ))}
    </section>
  );
}
