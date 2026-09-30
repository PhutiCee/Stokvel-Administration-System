"use client";
import { useEffect, useState } from "react";
import { ClipboardList } from "lucide-react";
import { governance } from "@/lib/api";
import { useSession } from "@/lib/session";
import Button from "@/components/ui/Button";
import { Input, Select, Textarea, Field } from "@/components/ui/Input";
import {
  Card,
  CardHeader,
  CardBody,
  Alert,
  Badge,
  Loading,
  Empty,
} from "@/components/ui/States";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
const fields = [
  ["contributionAmount", "Contribution amount (R)", "number"],
  ["penaltyAmount", "Late penalty (R)", "number"],
  ["gracePeriodDays", "Grace period (days)", "number"],
  ["quorumPercentage", "Quorum (%)", "number"],
  ["amendmentMajorityPercentage", "Amendment majority (%)", "number"],
  ["exitNoticeDays", "Exit notice (days)", "number"],
  ["forfeitureRule", "Exit forfeiture rule", "text"],
];
export default function GovernancePage() {
  const { can, club } = useSession();
  const mayRecord = can("governance.record");
  const [meetings, setMeetings] = useState(null),
    [selected, setSelected] = useState(null),
    [detail, setDetail] = useState(null);
  const [creating, setCreating] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [confirm, setConfirm] = useState(null);
  const [date, setDate] = useState(today),
    [candidates, setCandidates] = useState(null),
    [attendance, setAttendance] = useState([]);
  const [agenda, setAgenda] = useState(""),
    [minutes, setMinutes] = useState("");
  const [kind, setKind] = useState("General"),
    [text, setText] = useState(""),
    [votes, setVotes] = useState({
      votesFor: "",
      votesAgainst: "",
      abstentions: "",
    });
  const [memberId, setMemberId] = useState(""),
    [changes, setChanges] = useState({}),
    [effectiveDate, setEffectiveDate] = useState("");
  useEffect(() => {
    let live = true;
    governance
      .list()
      .then((v) => {
        if (live) setMeetings(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, []);
  useEffect(() => {
    let live = true;
    setDetail(null);
    if (selected)
      governance
        .get(selected)
        .then((v) => {
          if (live) setDetail(v);
        })
        .catch((e) => {
          if (live) setError(e.message);
        });
    return () => {
      live = false;
    };
  }, [selected]);
  useEffect(() => {
    if (!mayRecord) return;
    let live = true;
    setCandidates(null);
    setAttendance([]);
    governance
      .candidates(creating ? date : today())
      .then((v) => {
        if (live) setCandidates(v);
      })
      .catch((e) => {
        if (live) setError(e.message);
      });
    return () => {
      live = false;
    };
  }, [date, creating, club?.clubId, mayRecord]);
  async function run(fn) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  async function saveMeeting(e) {
    e.preventDefault();
    await run(async () => {
      const m = await governance.recordMeeting({
        date,
        agenda,
        minutes,
        attendance,
      });
      setMeetings(await governance.list());
      setSelected(m.meeting_id);
      setCreating(false);
      setAgenda("");
      setMinutes("");
      setNotice("Meeting and attendance recorded.");
    });
  }
  async function saveResolution(e) {
    e.preventDefault();
    await run(async () => {
      const proposed = Object.fromEntries(
        Object.entries(changes).filter(([, v]) => v !== ""),
      );
      if (proposed.benefitSchedule)
        proposed.benefitSchedule = proposed.benefitSchedule
          .split("\n")
          .filter(Boolean)
          .map((line) => {
            const parts = line.split(":");
            if (parts.length !== 2)
              throw new Error(
                "Use one dependant category and amount per line, for example Spouse: 10000.",
              );
            return { category: parts[0].trim(), amount: parts[1].trim() };
          });
      await governance.recordResolution(selected, {
        kind,
        text,
        ...Object.fromEntries(
          Object.entries(votes).map(([k, v]) => [k, Number(v)]),
        ),
        memberId,
        changes: proposed,
        effectiveDate,
      });
      setDetail(await governance.get(selected));
      setText("");
      setVotes({ votesFor: "", votesAgainst: "", abstentions: "" });
      setChanges({});
      setNotice("Resolution and voting outcome recorded.");
    });
  }
  const update = (key, value) => setChanges((s) => ({ ...s, [key]: value }));
  const attendanceCount = detail?.attendance_count || 0;
  const voteTotal = Object.values(votes).reduce((a, b) => a + Number(b), 0);
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-ink-500">
            Club records
          </p>
          <h1 className="text-2xl font-semibold text-ink-900">Governance</h1>
          <p className="text-sm text-ink-500 mt-1">
            Meetings, member decisions and constitution changes.
          </p>
        </div>
        {can("governance.record") && (
          <Button
            onClick={() => {
              setCreating(!creating);
              setError("");
            }}
          >
            {creating ? "Close meeting form" : "Record a meeting"}
          </Button>
        )}
      </div>
      {error && <Alert tone="exception">{error}</Alert>}
      {notice && <Alert tone="positive">{notice}</Alert>}
      {creating && (
        <Card>
          <CardHeader
            title="Record a completed meeting"
            description="Attendance and minutes become a permanent record. Check them before saving."
          />
          <CardBody>
            <form onSubmit={saveMeeting} className="space-y-4">
              <Field label="Meeting date" htmlFor="meeting-date" required>
                <Input
                  id="meeting-date"
                  type="date"
                  value={date}
                  max={today()}
                  required
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label="Agenda" htmlFor="agenda" required>
                <Textarea
                  id="agenda"
                  value={agenda}
                  required
                  maxLength={20000}
                  onChange={(e) => setAgenda(e.target.value)}
                />
              </Field>
              <Field label="Minutes" htmlFor="minutes" required>
                <Textarea
                  id="minutes"
                  value={minutes}
                  required
                  maxLength={20000}
                  onChange={(e) => setMinutes(e.target.value)}
                />
              </Field>
              {!candidates ? (
                <Loading label="Loading eligible members" />
              ) : (
                <fieldset>
                  <legend className="text-sm font-medium mb-2">
                    Members present
                  </legend>
                  <div className="grid sm:grid-cols-2 gap-2 max-h-64 overflow-y-auto">
                    {candidates.members.map((m) => (
                      <label
                        key={m.member_id}
                        className="flex items-center gap-2 text-sm p-2 border border-line rounded"
                      >
                        <input
                          type="checkbox"
                          checked={attendance.includes(m.member_id)}
                          onChange={(e) =>
                            setAttendance((a) =>
                              e.target.checked
                                ? [...a, m.member_id]
                                : a.filter((id) => id !== m.member_id),
                            )
                          }
                        />
                        {m.full_name}
                      </label>
                    ))}
                  </div>
                  <p className="text-sm mt-3">
                    {attendance.length} of {candidates.members.length} present ·{" "}
                    {Math.ceil(
                      (candidates.members.length *
                        candidates.constitution.quorumPercentage) /
                        100,
                    )}{" "}
                    required ({candidates.constitution.quorumPercentage}%).
                  </p>
                  <p className="text-xs text-ink-500 mt-1">
                    Without quorum, every resolution will be advisory and cannot
                    be applied.
                  </p>
                </fieldset>
              )}
              <Button
                variant="secondary"
                type="submit"
                loading={busy}
                disabled={!candidates}
              >
                Save meeting
              </Button>
            </form>
          </CardBody>
        </Card>
      )}
      {meetings === null ? (
        !error && <Loading />
      ) : meetings.length === 0 ? (
        <Empty icon={ClipboardList} title="No meetings recorded">
          The Secretary or Chairperson can record the first meeting.
        </Empty>
      ) : (
        <div className="grid lg:grid-cols-[260px_1fr] gap-5">
          <Card className="self-start">
            <CardHeader title="Meeting history" />
            <div className="divide-y divide-line">
              {meetings.map((m) => (
                <button
                  key={m.meeting_id}
                  onClick={() => {
                    setSelected(m.meeting_id);
                    setChanges({});
                    setText("");
                    setVotes({
                      votesFor: "",
                      votesAgainst: "",
                      abstentions: "",
                    });
                    setError("");
                  }}
                  className={`w-full text-left p-4 space-y-2 ${selected === m.meeting_id ? "bg-accent-50" : ""}`}
                >
                  <p className="text-sm font-semibold">{m.meeting_date}</p>
                  <p className="text-sm line-clamp-2">{m.agenda}</p>
                  <Badge tone={m.quorate ? "positive" : "attention"}>
                    {m.quorate ? "Quorum met" : "No quorum"}
                  </Badge>
                </button>
              ))}
            </div>
          </Card>
          {!selected ? (
            <Card>
              <Empty title="Select a meeting">
                View its minutes, attendance and resolutions.
              </Empty>
            </Card>
          ) : !detail ? (
            <Loading />
          ) : (
            <div className="space-y-5">
              <Card>
                <CardHeader
                  title={`Meeting · ${detail.meeting_date}`}
                  description={`${detail.attendance_count} of ${detail.eligible_count} members present; ${detail.required_count} required.`}
                />
                <CardBody>
                  <h2 className="font-semibold text-sm">Agenda</h2>
                  <p className="whitespace-pre-wrap text-sm mt-1">
                    {detail.agenda}
                  </p>
                  <h2 className="font-semibold text-sm mt-4">Minutes</h2>
                  <p className="whitespace-pre-wrap text-sm mt-1">
                    {detail.minutes}
                  </p>
                  <details className="mt-4 text-sm">
                    <summary className="cursor-pointer">
                      Attendance ({detail.attendance.length})
                    </summary>
                    <ul className="mt-2 space-y-1">
                      {detail.attendance.map((m) => (
                        <li key={m.member_id}>{m.full_name}</li>
                      ))}
                    </ul>
                  </details>
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Resolutions" />
                {detail.resolutions.length === 0 ? (
                  <Empty title="No resolutions recorded" />
                ) : (
                  <CardBody className="space-y-5">
                    {detail.resolutions.map((r) => (
                      <article
                        key={r.resolution_id}
                        className="border border-line rounded p-4 space-y-3"
                      >
                        <div className="flex flex-wrap justify-between gap-2">
                          <span className="font-semibold text-sm">
                            {r.kind}
                          </span>
                          <Badge
                            tone={
                              r.applied_at
                                ? "positive"
                                : r.outcome === "Carried"
                                  ? "accent"
                                  : "attention"
                            }
                          >
                            {r.applied_at ? "Applied" : r.outcome}
                          </Badge>
                        </div>
                        <p className="text-sm whitespace-pre-wrap">{r.text}</p>
                        <p className="text-xs text-ink-500">
                          For: {r.votes_for} · Against: {r.votes_against} ·
                          Abstained: {r.abstentions} · Required:{" "}
                          {r.required_votes}
                        </p>
                        {r.kind === "Amendment" && (
                          <div className="text-sm">
                            <p>Effective date: {r.payload.effectiveDate}</p>
                            <dl className="mt-2 space-y-1">
                              {Object.entries(r.payload.changes).map(
                                ([k, v]) => (
                                  <div key={k}>
                                    <dt className="inline font-medium">
                                      {fields.find((f) => f[0] === k)?.[1] ||
                                        k.replace(/([A-Z])/g, " $1")}
                                      :{" "}
                                    </dt>
                                    <dd className="inline">
                                      {typeof v === "object"
                                        ? v
                                            .map(
                                              (x) =>
                                                `${x.category}: R${x.amount}`,
                                            )
                                            .join(", ")
                                        : String(v)}
                                    </dd>
                                  </div>
                                ),
                              )}
                            </dl>
                          </div>
                        )}
                        {r.kind === "Expulsion" && (
                          <p className="text-sm">
                            Member: {r.subject_name || r.payload.memberId}
                          </p>
                        )}
                        {!r.applied_at &&
                          r.outcome === "Carried" &&
                          can("governance.apply") && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setConfirm(r)}
                            >
                              Give effect
                            </Button>
                          )}
                        {r.outcome === "Advisory" && (
                          <p className="text-xs text-ink-500">
                            Not binding: this meeting did not meet quorum.
                          </p>
                        )}
                      </article>
                    ))}
                  </CardBody>
                )}
              </Card>
              {can("governance.record") && (
                <Card>
                  <CardHeader
                    title="Record a resolution"
                    description="Include every attendee in the vote totals. Abstentions count toward attendance, but not votes in favour."
                  />
                  <CardBody>
                    <form onSubmit={saveResolution} className="space-y-4">
                      <Field label="Resolution type" htmlFor="kind">
                        <Select
                          id="kind"
                          value={kind}
                          onChange={(e) => setKind(e.target.value)}
                        >
                          <option>General</option>
                          {can("constitution.propose") && (
                            <option>Amendment</option>
                          )}
                          <option>Expulsion</option>
                        </Select>
                      </Field>
                      <Field
                        label="Resolution text and reason"
                        htmlFor="resolution-text"
                        required
                      >
                        <Textarea
                          id="resolution-text"
                          value={text}
                          onChange={(e) => setText(e.target.value)}
                          required
                          maxLength={20000}
                        />
                      </Field>
                      {kind === "Expulsion" && (
                        <Field
                          label="Member to expel"
                          htmlFor="expel-member"
                          required
                        >
                          <Select
                            id="expel-member"
                            value={memberId}
                            onChange={(e) => setMemberId(e.target.value)}
                            required
                          >
                            <option value="">Select a member</option>
                            {candidates?.members.map((m) => (
                              <option key={m.member_id} value={m.member_id}>
                                {m.full_name}
                              </option>
                            ))}
                          </Select>
                        </Field>
                      )}
                      {kind === "Amendment" && (
                        <fieldset className="border border-line rounded p-4 space-y-4">
                          <legend className="text-sm font-semibold px-1">
                            Proposed constitution changes
                          </legend>
                          <p className="text-xs text-ink-500">
                            Fill only the rules being changed. Constitution
                            version {detail.constitutionVersion} requires{" "}
                            {detail.amendmentMajorityPercentage}% of attendees
                            to vote in favour.
                          </p>
                          <Field
                            label="Effective date"
                            htmlFor="effective-date"
                            required
                          >
                            <Input
                              id="effective-date"
                              type="date"
                              min={today()}
                              value={effectiveDate}
                              onChange={(e) => setEffectiveDate(e.target.value)}
                              required
                            />
                          </Field>
                          <div className="grid sm:grid-cols-2 gap-3">
                            {fields.map(([key, label, type]) => (
                              <Field key={key} label={label} htmlFor={key}>
                                <Input
                                  id={key}
                                  type={type}
                                  step={key.endsWith("Amount") ? "0.01" : "1"}
                                  min={
                                    key === "amendmentMajorityPercentage"
                                      ? 51
                                      : 0
                                  }
                                  max={
                                    key.endsWith("Percentage") ? 100 : undefined
                                  }
                                  value={changes[key] ?? ""}
                                  onChange={(e) => update(key, e.target.value)}
                                />
                              </Field>
                            ))}
                          </div>
                          <Field label="Cycle frequency" htmlFor="frequency">
                            <Select
                              id="frequency"
                              value={changes.cycleFrequency || ""}
                              onChange={(e) =>
                                update("cycleFrequency", e.target.value)
                              }
                            >
                              <option value="">Keep existing</option>
                              <option>Weekly</option>
                              <option>Fortnightly</option>
                              <option>Monthly</option>
                            </Select>
                          </Field>
                          {club?.clubType === "Rotating" && (
                            <Field label="Payout order" htmlFor="payout-order">
                              <Select
                                id="payout-order"
                                value={changes.payoutOrderMethod || ""}
                                onChange={(e) =>
                                  update("payoutOrderMethod", e.target.value)
                                }
                              >
                                <option value="">Keep existing</option>
                                <option>Random draw</option>
                                <option>Seniority</option>
                                <option>Negotiated</option>
                              </Select>
                            </Field>
                          )}
                          {club?.clubType === "Burial" && (
                            <>
                              <Field
                                label="Waiting period (days)"
                                htmlFor="waiting"
                              >
                                <Input
                                  id="waiting"
                                  type="number"
                                  min="0"
                                  value={changes.waitingPeriodDays ?? ""}
                                  onChange={(e) =>
                                    update("waitingPeriodDays", e.target.value)
                                  }
                                />
                              </Field>
                              <Field
                                label="Benefit schedule"
                                htmlFor="benefits"
                                hint="One category and amount per line, e.g. Spouse: 10000. Enter the complete replacement schedule."
                              >
                                <Textarea
                                  id="benefits"
                                  value={changes.benefitSchedule || ""}
                                  onChange={(e) =>
                                    update("benefitSchedule", e.target.value)
                                  }
                                />
                              </Field>
                            </>
                          )}
                          {club?.clubType === "Accumulating" && (
                            <div className="grid grid-cols-2 gap-3">
                              {[
                                ["yearEndMonth", "Year-end month", 12],
                                ["yearEndDay", "Year-end day", 31],
                              ].map(([key, label, max]) => (
                                <Field key={key} label={label} htmlFor={key}>
                                  <Input
                                    id={key}
                                    type="number"
                                    min="1"
                                    max={max}
                                    value={changes[key] ?? ""}
                                    onChange={(e) =>
                                      update(key, e.target.value)
                                    }
                                  />
                                </Field>
                              ))}
                            </div>
                          )}
                        </fieldset>
                      )}
                      <div className="grid grid-cols-3 gap-3">
                        {[
                          ["votesFor", "In favour"],
                          ["votesAgainst", "Against"],
                          ["abstentions", "Abstaining"],
                        ].map(([key, label]) => (
                          <Field key={key} label={label} htmlFor={key} required>
                            <Input
                              id={key}
                              type="number"
                              min="0"
                              max={attendanceCount}
                              step="1"
                              value={votes[key]}
                              required
                              onChange={(e) =>
                                setVotes((v) => ({
                                  ...v,
                                  [key]: e.target.value,
                                }))
                              }
                            />
                          </Field>
                        ))}
                      </div>
                      <p className="text-sm">
                        {voteTotal} of {attendanceCount} attendees accounted
                        for.
                      </p>
                      {!detail.quorate && (
                        <Alert tone="attention">
                          This resolution will be advisory because the meeting
                          did not meet quorum.
                        </Alert>
                      )}
                      <Button
                        variant="secondary"
                        type="submit"
                        loading={busy}
                        disabled={voteTotal !== attendanceCount}
                      >
                        Record resolution
                      </Button>
                    </form>
                  </CardBody>
                </Card>
              )}
            </div>
          )}
        </div>
      )}
      {confirm && (
        <ConfirmDialog
          title="Give effect to this resolution?"
          description={
            confirm.kind === "Expulsion"
              ? "This ends the membership and removes the member from the payout queue. Their financial history is retained."
              : confirm.kind === "Amendment"
                ? "This creates a new constitution version with exactly the changes recorded in the vote."
                : "This records that the carried decision has been put into effect."
          }
          requireReason={false}
          confirmLabel="Give effect"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await governance.apply(confirm.resolution_id);
            setDetail(await governance.get(selected));
            setNotice("Resolution given effect.");
          }}
        />
      )}
    </div>
  );
}
