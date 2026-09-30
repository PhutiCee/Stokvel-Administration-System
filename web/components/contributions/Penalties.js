"use client";
import { useEffect, useState } from "react";
import { contributions as api } from "@/lib/api";
import { money, fmtDate } from "@/lib/format";
import Button from "@/components/ui/Button";
import { Field, Select } from "@/components/ui/Input";
import { Card, Alert, Badge, Loading } from "@/components/ui/States";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
export default function Penalties({ canWaive, refreshKey }) {
  const [status, setStatus] = useState("all"),
    [offset, setOffset] = useState(0);
  const [data, setData] = useState(null),
    [error, setError] = useState("");
  const [waiving, setWaiving] = useState(null),
    [revision, setRevision] = useState(0);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    setError("");
    api
      .penalties(status, offset, { signal: c.signal })
      .then((d) => {
        if (!c.signal.aborted) setData(d);
      })
      .catch((e) => {
        if (!c.signal.aborted) setError(e.message);
      });
    return () => c.abort();
  }, [status, offset, revision, refreshKey]);
  return (
    <section className="mt-8" aria-labelledby="penalties-heading">
      <h2 id="penalties-heading" className="font-semibold mb-3">
        Penalties
      </h2>
      <div className="max-w-xs mb-4">
        <Field label="Show penalties" htmlFor="penalty-status">
          <Select
            id="penalty-status"
            value={status}
            onChange={(e) => {
              setStatus(e.target.value);
              setOffset(0);
            }}
          >
            {["all", "outstanding", "settled", "waived"].map((s) => (
              <option key={s} value={s}>
                {s[0].toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      {notice && (
        <p role="status" className="text-sm mb-3">
          {notice}
        </p>
      )}
      {error ? (
        <Alert tone="exception">
          {error}
          <Button
            size="sm"
            variant="ghost"
            onClick={() => setRevision((v) => v + 1)}
          >
            Retry
          </Button>
        </Alert>
      ) : !data ? (
        <Loading label="Loading penalties" />
      ) : (
        <>
          {!data.penalties.length && (
            <p className="text-sm text-ink-500">
              No penalties match this filter.
            </p>
          )}
          <ul className="space-y-3">
            {data.penalties.map((p) => (
              <li key={p.penaltyId}>
                <Card className="p-4 space-y-2">
                  <div className="flex flex-wrap gap-2 justify-between">
                    <h3 className="font-medium">
                      {p.fullName} · {money(p.amount)}
                    </h3>
                    <Badge>{p.status}</Badge>
                  </div>
                  <p className="text-sm text-ink-500">
                    {p.cycleNumber ? `Cycle ${p.cycleNumber} · ` : ""}
                    {fmtDate(p.leviedAt)}
                  </p>
                  <p className="text-sm break-words">{p.reason}</p>
                  <p className="text-sm">
                    Settled: {money(p.settledAmount)} · Outstanding:{" "}
                    {money(p.outstandingAmount)}
                  </p>
                  {p.status === "Waived" ? (
                    <p className="text-sm break-words">
                      Waived by {p.waivedBy} on {fmtDate(p.waivedAt)}:{" "}
                      {p.waiverReason}
                    </p>
                  ) : (
                    canWaive && (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => setWaiving(p)}
                      >
                        Waive penalty
                      </Button>
                    )
                  )}
                </Card>
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="flex items-center gap-3 mt-3">
        <Button
          size="sm"
          variant="secondary"
          disabled={!offset || (!data && !error)}
          onClick={() => setOffset((v) => Math.max(0, v - 50))}
        >
          Previous
        </Button>
        <span className="text-sm">Page {offset / 50 + 1}</span>
        <Button
          size="sm"
          variant="secondary"
          disabled={!data?.hasMore}
          onClick={() => setOffset((v) => v + 50)}
        >
          Next
        </Button>
      </div>
      {waiving && (
        <ConfirmDialog
          title={`Waive penalty for ${waiving.fullName}`}
          description={`The original penalty of ${money(waiving.amount)} will be reversed in the ledger. A reason is required; the waiver cannot be undone here.`}
          confirmLabel="Waive penalty"
          onClose={() => setWaiving(null)}
          onConfirm={async (reason) => {
            await api.waive(waiving.penaltyId, reason);
            setNotice("Penalty waived and reversing entry posted.");
            setRevision((v) => v + 1);
          }}
        />
      )}
    </section>
  );
}
