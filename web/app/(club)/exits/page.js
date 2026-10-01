"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { money, fmtDate } from "@/lib/format";
import { PageHeader } from "@/components/shell/ClubShell";
import { Action, Feedback, fieldClass } from "@/components/ui/Workflow";
export default function Exits() {
  const { can, role, membership } = useSession();
  const [selectedWriteoffs, setSelectedWriteoffs] = useState({});
  const [settings, setSettings] = useState(null),
    [notices, setNotices] = useState([]),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [reason, setReason] = useState(""),
    [attest, setAttest] = useState(false),
    [policy, setPolicy] = useState({
      period: "membership",
      forfeitPercent: "",
      deductPayouts: false,
      deductPenalties: false,
      deductCosts: false,
    });
  async function load(signal) {
    const [s, n] = await Promise.all([
      api.get("/api/exits/settings", { signal }),
      api.get("/api/exits", { signal }),
    ]);
    setSettings(s);
    setNotices(n.notices);
  }
  useEffect(() => {
    const c = new AbortController();
    load(c.signal).catch((e) => {
      if (e.name !== "AbortError") setError(e.message);
    });
    return () => c.abort();
  }, []);
  async function run(path, data) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.post("/api/exits" + path, data);
      await load();
      setMessage("Saved.");
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Membership exits"
        description="Give notice, review the calculated settlement, then obtain Chairperson approval."
      />
      <Feedback error={error} message={message} />
      {settings && (
        <section className="border border-line rounded p-4 mb-5">
          <h2 className="font-semibold">
            Constitution version {settings.constitution.version}
          </h2>
          <p>Notice period: {settings.constitution.noticeDays} days</p>
          <p className="whitespace-pre-wrap my-3">
            {settings.constitution.rule || "No forfeiture rule recorded."}
          </p>
          {settings.mapping ? (
            <p>
              Calculation settings recorded. Each notice keeps this constitution
              version.
            </p>
          ) : (
            <>
              <p className="my-2">
                An approved calculation mapping is required before notice can be
                calculated. Conditional rules must be resolved before using
                these settings.
              </p>
              {can("exit.configure") && (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    run("/settings", {
                      constitutionId: settings.constitution.id,
                      policy,
                      attest,
                    });
                  }}
                >
                  <fieldset disabled={busy}>
                    <label>
                      Contribution calculation period
                      <select
                        className={fieldClass}
                        value={policy.period}
                        onChange={(e) =>
                          setPolicy({ ...policy, period: e.target.value })
                        }
                      >
                        <option value="membership">Since joining</option>
                        <option value="calendarYear">
                          Calendar year of notice
                        </option>
                        <option value="constitutionStart">
                          Constitution cycle start
                        </option>
                      </select>
                    </label>
                    <label>
                      Forfeiture after deductions (%)
                      <input
                        required
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        className={fieldClass}
                        value={policy.forfeitPercent}
                        onChange={(e) =>
                          setPolicy({
                            ...policy,
                            forfeitPercent: e.target.value,
                          })
                        }
                      />
                    </label>
                    {[
                      ["deductPayouts", "Deduct prior payouts"],
                      ["deductPenalties", "Deduct unpaid penalties"],
                      [
                        "deductCosts",
                        "Deduct proportionate administrative costs",
                      ],
                    ].map(([key, label]) => (
                      <label key={key} className="block my-2">
                        <input
                          type="checkbox"
                          checked={policy[key]}
                          onChange={(e) =>
                            setPolicy({ ...policy, [key]: e.target.checked })
                          }
                        />{" "}
                        {label}
                      </label>
                    ))}
                    <label className="block my-3">
                      <input
                        required
                        type="checkbox"
                        checked={attest}
                        onChange={(e) => setAttest(e.target.checked)}
                      />{" "}
                      These settings implement the entire adopted rule,
                      including its period and deductions. There are no
                      unrepresented conditions.
                    </label>
                    <Action type="submit">
                      Record immutable calculation mapping
                    </Action>
                  </fieldset>
                </form>
              )}
            </>
          )}
        </section>
      )}
      <Action
        disabled={busy || !settings?.mapping}
        onClick={() => run("/", {})}
      >
        Submit my exit notice
      </Action>
      <label className="block mt-4">
        Reason for cancelling a notice
        <input
          className={fieldClass}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={2000}
        />
      </label>
      {notices.length === 0 && <p>No exit notices.</p>}
      {notices.map((n) => (
        <section
          key={n.notice_id}
          className="border border-line rounded p-4 my-4"
        >
          <h2 className="font-semibold">
            {n.full_name} · {n.status}
          </h2>
          <p>
            Notice: {fmtDate(n.notice_date)} · Earliest exit:{" "}
            {fmtDate(n.earliest_exit)}
          </p>
          {n.assessment && (
            <dl className="my-3">
              {[
                ["contributions", "Contributions"],
                ["priorPayouts", "Prior payouts deducted"],
                ["penaltyDeduction", "Penalty deduction"],
                ["costDeduction", "Cost deduction"],
                ["percentageForfeit", "Percentage forfeiture"],
                ["repayable", "Repayment"],
                ["forfeited", "Total retained"],
                ["outstanding", "Outstanding at assessment"],
              ].map(([key, label]) => (
                <div key={key}>
                  {label}: {money(n.assessment.calculation[key])}
                </div>
              ))}
            </dl>
          )}
          {n.writeoff_resolution_id && (
            <p className="my-2">
              Contribution debt written off under resolution{" "}
              {n.writeoff_resolution_id}.
            </p>
          )}
          {n.status === "Pending" && role === "Chairperson" && (
            <label className="block my-3">
              Carried debt write-off resolution (if needed)
              <select
                className={fieldClass}
                value={selectedWriteoffs[n.notice_id] || ""}
                onChange={(e) =>
                  setSelectedWriteoffs({
                    ...selectedWriteoffs,
                    [n.notice_id]: e.target.value,
                  })
                }
              >
                <option value="">No debt write-off</option>
                {(n.writeoff_resolutions || [])
                  .filter((r) => !r.applied)
                  .map((r) => (
                    <option key={r.resolutionId} value={r.resolutionId}>
                      {money(r.amount)} — {r.text}
                    </option>
                  ))}
              </select>
            </label>
          )}
          {n.status === "Pending" && (
            <>
              {can("exit.assess") && (
                <Action
                  disabled={busy}
                  onClick={() => run("/" + n.notice_id + "/assess", {})}
                >
                  Prepare / refresh assessment
                </Action>
              )}
              {role === "Chairperson" && (
                <Action
                  disabled={busy}
                  onClick={() =>
                    run("/" + n.notice_id + "/decision", {
                      decision: "approve",
                      writeoffResolutionId:
                        selectedWriteoffs[n.notice_id] || null,
                    })
                  }
                >
                  Approve settlement and exit
                </Action>
              )}
              {(role === "Chairperson" ||
                n.member_id === membership?.memberId) && (
                <Action
                  disabled={busy || !reason.trim()}
                  onClick={() =>
                    run("/" + n.notice_id + "/decision", {
                      decision: "cancel",
                      reason,
                    })
                  }
                >
                  Cancel notice
                </Action>
              )}
            </>
          )}
        </section>
      ))}
    </>
  );
}
