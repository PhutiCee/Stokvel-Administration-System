"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { PageHeader } from "@/components/shell/ClubShell";
import { Action, Feedback, fieldClass } from "@/components/ui/Workflow";
export default function Beneficiaries() {
  const [rows, setRows] = useState(null),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false);
  const present = (d) =>
    d.beneficiaries.length
      ? d.beneficiaries.map((r) => ({
          name: r.name,
          relationship: r.relationship || "",
          share: r.share_percent,
        }))
      : [{ name: "", relationship: "", share: "100.00" }];
  useEffect(() => {
    const c = new AbortController();
    api
      .get("/api/beneficiaries", { signal: c.signal })
      .then((d) => setRows(present(d)))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, []);
  const edit = (i, key, value) =>
    setRows(rows.map((r, n) => (n === i ? { ...r, [key]: value } : r)));
  async function save(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      setRows(
        present(await api.put("/api/beneficiaries", { beneficiaries: rows })),
      );
      setMessage("Beneficiaries saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="My beneficiaries"
        description="Nominate one or more people. Shares must total exactly 100%."
      />
      <Feedback error={error} message={message} />
      {rows ? (
        <form onSubmit={save}>
          <fieldset disabled={busy}>
            {rows.map((r, i) => (
              <div key={i} className="p-4 mb-3 border border-line rounded">
                <h2>Beneficiary {i + 1}</h2>
                <label>
                  Name
                  <input
                    required
                    maxLength={120}
                    className={fieldClass}
                    value={r.name}
                    onChange={(e) => edit(i, "name", e.target.value)}
                  />
                </label>
                <label>
                  Relationship
                  <input
                    required
                    maxLength={60}
                    className={fieldClass}
                    value={r.relationship}
                    onChange={(e) => edit(i, "relationship", e.target.value)}
                  />
                </label>
                <label>
                  Share (%)
                  <input
                    required
                    type="number"
                    min="0.01"
                    max="100"
                    step="0.01"
                    className={fieldClass}
                    value={r.share}
                    onChange={(e) => edit(i, "share", e.target.value)}
                  />
                </label>
                <Action
                  type="button"
                  disabled={rows.length === 1}
                  onClick={() => setRows(rows.filter((_, n) => n !== i))}
                >
                  Remove
                </Action>
              </div>
            ))}
            <p>
              Total:{" "}
              {(
                rows.reduce(
                  (sum, r) => sum + Math.round(Number(r.share || 0) * 100),
                  0,
                ) / 100
              ).toFixed(2)}
              %
            </p>
            <Action
              type="button"
              disabled={rows.length >= 20}
              onClick={() =>
                setRows([...rows, { name: "", relationship: "", share: "" }])
              }
            >
              Add beneficiary
            </Action>
            <Action type="submit">
              {busy ? "Saving…" : "Save nominations"}
            </Action>
          </fieldset>
        </form>
      ) : (
        !error && <p>Loading beneficiaries…</p>
      )}
    </>
  );
}
