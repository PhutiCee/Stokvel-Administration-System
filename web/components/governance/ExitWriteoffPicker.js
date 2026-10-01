"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { money } from "@/lib/format";
import { Action, fieldClass } from "@/components/ui/Workflow";
export default function ExitWriteoffPicker({ onChange }) {
  const [rows, setRows] = useState([]),
    [selected, setSelected] = useState(""),
    [error, setError] = useState(""),
    [enabled, setEnabled] = useState(false);
  useEffect(() => {
    const c = new AbortController();
    api
      .get("/api/exits/writeoff-candidates", { signal: c.signal })
      .then((d) => setRows(d.candidates))
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, []);
  const item = rows.find((r) => r.notice_id === selected);
  async function refresh() {
    setError("");
    setSelected("");
    onChange(null);
    try {
      setRows((await api.get("/api/exits/writeoff-candidates")).candidates);
    } catch (e) {
      setError(e.message);
    }
  }
  return (
    <div className="p-3 border border-line rounded">
      <label>
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => {
            setEnabled(e.target.checked);
            setSelected("");
            onChange(null);
          }}
        />{" "}
        This General resolution expressly writes off contribution debt for an
        exit
      </label>
      {enabled && (
        <>
          <p className="text-sm my-2">
            Record this vote on the meeting date. The exact debts below become
            part of the permanent resolution. They take effect only when the
            Chairperson approves the exit.
          </p>
          {error && <p role="alert">{error}</p>}
          <label>
            Pending exit
            <select
              required
              className={fieldClass}
              value={selected}
              onChange={(e) => {
                setSelected(e.target.value);
                onChange(
                  rows.find((r) => r.notice_id === e.target.value)?.snapshot ||
                    null,
                );
              }}
            >
              <option value="">Choose the member and debt</option>
              {rows.map((r) => (
                <option key={r.notice_id} value={r.notice_id}>
                  {r.full_name} — {money(r.snapshot.amount)}
                </option>
              ))}
            </select>
          </label>
          {item && (
            <div>
              <strong>Total to write off: {money(item.snapshot.amount)}</strong>
              {item.snapshot.items.map((d) => (
                <p key={d.contributionId} className="text-sm break-all">
                  Contribution {d.contributionId}: expected {money(d.expected)},
                  paid {money(d.captured)}, write off {money(d.amount)}
                </p>
              ))}
            </div>
          )}
          <Action type="button" onClick={refresh}>
            Refresh debt amounts
          </Action>
        </>
      )}
    </div>
  );
}
