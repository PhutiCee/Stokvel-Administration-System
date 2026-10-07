"use client";
import { useEffect, useState } from "react";
import { governance } from "@/lib/api";
import { useSession } from "@/lib/session";
import Button from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import {
  Card,
  CardHeader,
  CardBody,
  Alert,
  Badge,
  Empty,
  Loading,
} from "@/components/ui/States";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import PolicyEditor, {
  emptyPolicy,
  PolicySummary,
  FIELD_LABELS,
  describeRule,
} from "@/components/governance/PolicyEditor";
import ExitWriteoffPicker from "@/components/governance/ExitWriteoffPicker";
import AnnualReport from "@/components/governance/AnnualReport";
import StandingPanel from "@/components/governance/StandingPanel";
import ConstitutionSummary from "@/components/governance/ConstitutionSummary";
import AmendmentForm from "@/components/governance/AmendmentForm";
const today = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "Africa/Johannesburg",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
function Changes({ changes }) {
  return (
    <dl className="space-y-2 text-sm">
      {Object.entries(changes).map(([key, value]) => (
        <div key={key}>
          <dt className="font-medium">{FIELD_LABELS[key] || key}</dt>
          <dd>
            {key === "governancePolicy" ? (
              <PolicySummary policy={value} />
            ) : Array.isArray(value) ? (
              value.map((v) => `${v.category}: R${v.amount}`).join("; ")
            ) : (
              String(value)
            )}
          </dd>
        </div>
      ))}
    </dl>
  );
}
export default function GovernancePage() {
  const { can, club } = useSession(),
    mayRecord = can("governance.record"),
    mayPropose = can("constitution.propose");
  const [meetings, setMeetings] = useState(null),
    [settings, setSettings] = useState(null),
    [proposals, setProposals] = useState([]),
    [selected, setSelected] = useState(""),
    [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [creating, setCreating] = useState(false),
    [proposing, setProposing] = useState(false),
    [confirm, setConfirm] = useState(null);
  const [date, setDate] = useState(today),
    [agenda, setAgenda] = useState(""),
    [minutes, setMinutes] = useState(""),
    [attendance, setAttendance] = useState([]),
    [candidates, setCandidates] = useState(null),
    [people, setPeople] = useState([]);
  const [policy, setPolicy] = useState(emptyPolicy),
    [policyDate, setPolicyDate] = useState(""),
    [attested, setAttested] = useState(false),
    [refreshKey, setRefreshKey] = useState(0);
  const [exitWriteOff, setExitWriteOff] = useState(null);
  const [kind, setKind] = useState("General"),
    [text, setText] = useState(""),
    [proposalId, setProposalId] = useState(""),
    [memberId, setMemberId] = useState(""),
    [successor, setSuccessor] = useState(""),
    [votes, setVotes] = useState({
      votesFor: "",
      votesAgainst: "",
      abstentions: "",
    });
  useEffect(() => {
    let active = true;
    Promise.all([
      governance.list(),
      governance.settings(),
      governance.proposals(),
    ])
      .then(([m, s, p]) => {
        if (active) {
          setMeetings(m);
          setSettings(s);
          setProposals(p);
          if (s.canInitialise)
            setPolicy((old) => (old.source ? old : emptyPolicy(s.fields)));
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [refreshKey, club?.clubId]);
  useEffect(() => {
    let active = true;
    setDetail(null);
    if (selected)
      governance
        .get(selected)
        .then((d) => {
          if (active) setDetail(d);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [selected, refreshKey]);
  useEffect(() => {
    if (!mayRecord) return;
    let active = true;
    setAttendance([]);
    setCandidates(null);
    Promise.all([governance.candidates(date), governance.candidates(today())])
      .then(([a, b]) => {
        if (active) {
          setCandidates(a);
          setPeople(b.members);
        }
      })
      .catch((e) => {
        if (active) setError(e.message);
      });
    return () => {
      active = false;
    };
  }, [date, mayRecord, refreshKey, club?.clubId]);
  async function action(fn, message) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await fn();
      setRefreshKey((k) => k + 1);
      setNotice(message);
      return true;
    } catch (e) {
      setError(e.message);
      return false;
    } finally {
      setBusy(false);
    }
  }
  function resetVote() {
    setExitWriteOff(null);
    setText("");
    setVotes({ votesFor: "", votesAgainst: "", abstentions: "" });
    setProposalId("");
    setMemberId("");
    setSuccessor("");
  }
  async function saveMeeting(e) {
    e.preventDefault();
    await action(async () => {
      const m = await governance.recordMeeting({
        date,
        agenda,
        minutes,
        attendance,
      });
      setSelected(m.meeting_id);
      setCreating(false);
      setAgenda("");
      setMinutes("");
      resetVote();
    }, "Meeting and constitutional voting rules recorded.");
  }
  async function saveVote(e) {
    e.preventDefault();
    await action(async () => {
      await governance.recordResolution(selected, {
        kind,
        text,
        proposalId,
        memberId,
        successorMemberId: successor || null,
        exitWriteOff: kind === "General" ? exitWriteOff : null,
        ...Object.fromEntries(
          Object.entries(votes).map(([k, v]) => [k, Number(v)]),
        ),
      });
      resetVote();
    }, "Vote recorded. Only a carried decision can be applied.");
  }
  const totalVotes = Object.values(votes).reduce(
      (a, b) => a + Number(b || 0),
      0,
    ),
    chosenProposal = proposals.find((p) => p.proposal_id === proposalId),
    subject = people.find((m) => m.member_id === memberId);
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-widest text-ink-500">
            Club records
          </p>
          <h1 className="text-2xl font-semibold">Governance</h1>
          <p className="text-sm text-ink-500 mt-1">
            Constitutional rules, pending proposals, meetings and decisions.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {mayRecord && (
            <Button
              disabled={!settings?.policy || busy}
              onClick={() => setCreating((v) => !v)}
            >
              {creating ? "Close meeting form" : "Record a meeting"}
            </Button>
          )}
          {mayPropose && (
            <Button
              variant="secondary"
              disabled={!settings?.policy || busy}
              onClick={() => setProposing((v) => !v)}
            >
              {proposing ? "Close proposal form" : "Propose amendment"}
            </Button>
          )}
        </div>
      </div>
      {settings && <ConstitutionSummary value={settings.constitution} />}
      {can("view.members") && <StandingPanel />}
      {error && <Alert tone="exception">{error}</Alert>}
      {notice && <Alert tone="positive">{notice}</Alert>}
      {settings && !settings.policy && (
        <Card>
          <CardHeader
            title="Record the adopted voting rules"
            description="No voting majority is assumed. Copy the club’s existing constitution before recording new binding decisions."
          />
          <CardBody>
            {mayPropose && settings.canInitialise ? (
              <form
                className="space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  action(
                    () =>
                      governance.recordPolicy({
                        policy,
                        effectiveDate: policyDate,
                        confirmAdopted: attested,
                      }),
                    "Adopted voting rules recorded. Future changes require a member resolution.",
                  );
                }}
              >
                <fieldset disabled={busy} className="space-y-4">
                  <PolicyEditor
                    fields={settings.fields}
                    value={policy}
                    onChange={setPolicy}
                  />
                  <Field
                    label="Date these rules took effect"
                    htmlFor="policy-date"
                  >
                    <Input
                      id="policy-date"
                      type="date"
                      required
                      max={today()}
                      min={settings.constitution.effectiveDate}
                      value={policyDate}
                      onChange={(e) => setPolicyDate(e.target.value)}
                    />
                  </Field>
                  <label className="flex gap-2 text-sm">
                    <input
                      type="checkbox"
                      required
                      checked={attested}
                      onChange={(e) => setAttested(e.target.checked)}
                    />
                    I am recording existing adopted rules from the cited
                    constitution, not changing the rules.
                  </label>
                  <Button type="submit" loading={busy}>
                    Record adopted rules
                  </Button>
                </fieldset>
              </form>
            ) : (
              <Alert>
                Ask the Chairperson to record the club’s adopted constitutional
                voting rules.
              </Alert>
            )}
          </CardBody>
        </Card>
      )}
      {settings?.policy && (
        <Card>
          <CardBody>
            <details>
              <summary className="cursor-pointer font-semibold text-sm">
                Current voting rules · constitution version{" "}
                {settings.constitution.version}
              </summary>
              <div className="mt-3">
                <PolicySummary policy={settings.policy} />
              </div>
            </details>
          </CardBody>
        </Card>
      )}
      {proposing && settings?.policy && (
        <Card>
          <CardHeader
            title="Submit an amendment for a member vote"
            description="Submitting a proposal changes no rules. A quorate meeting must pass it under the existing constitution."
          />
          <CardBody>
            <AmendmentForm
              clubType={club?.clubType}
              currentPolicy={settings.policy}
              policyFields={settings.fields}
              busy={busy}
              today={today()}
              onSubmit={(data) =>
                action(
                  () => governance.propose(data),
                  "Pending proposal submitted. The Secretary can record its vote at a meeting.",
                )
              }
            />
          </CardBody>
        </Card>
      )}
      <Card>
        <CardHeader title="Amendment proposals" />
        {!proposals.length ? (
          <Empty title="No amendment proposals" />
        ) : (
          <CardBody className="space-y-3">
            {proposals.map((p) => (
              <details
                key={p.proposal_id}
                className="border border-line rounded p-3"
              >
                <summary className="cursor-pointer text-sm">
                  <Badge tone={p.status === "Applied" ? "positive" : "neutral"}>
                    {p.status}
                  </Badge>{" "}
                  <span className="ml-2">{p.text}</span>
                </summary>
                <div className="mt-3 space-y-3">
                  <p className="text-sm">
                    Proposed effective date: {p.effective_date}
                  </p>
                  <Changes changes={p.changes} />
                  {p.status === "Pending" && p.effective_date < today() && (
                    <Alert tone="attention">
                      The effective date has passed. Submit a new proposal with
                      a prospective date.
                    </Alert>
                  )}
                </div>
              </details>
            ))}
          </CardBody>
        )}
      </Card>
      {creating && (
        <Card>
          <CardHeader
            title="Record a completed meeting"
            description="Quorum uses active membership. Votes include only those entitled to vote under the constitution."
          />
          <CardBody>
            <form onSubmit={saveMeeting} className="space-y-4">
              <fieldset disabled={busy} className="space-y-4">
                <Field label="Meeting date" htmlFor="meeting-date">
                  <Input
                    id="meeting-date"
                    type="date"
                    required
                    max={today()}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                  />
                </Field>
                <Field label="Agenda" htmlFor="agenda">
                  <Textarea
                    id="agenda"
                    required
                    maxLength={20000}
                    value={agenda}
                    onChange={(e) => setAgenda(e.target.value)}
                  />
                </Field>
                <Field label="Minutes" htmlFor="minutes">
                  <Textarea
                    id="minutes"
                    required
                    maxLength={20000}
                    value={minutes}
                    onChange={(e) => setMinutes(e.target.value)}
                  />
                </Field>
                {!candidates ? (
                  <p className="text-sm">
                    Choose a date with available membership history.
                  </p>
                ) : (
                  <fieldset>
                    <legend className="text-sm font-semibold mb-2">
                      Members present
                    </legend>
                    <div className="grid sm:grid-cols-2 gap-2 max-h-64 overflow-auto">
                      {candidates.members.map((m) => (
                        <label
                          key={m.member_id}
                          className="text-sm flex gap-2 p-2 border border-line rounded"
                        >
                          <input
                            type="checkbox"
                            checked={attendance.includes(m.member_id)}
                            onChange={(e) =>
                              setAttendance((a) =>
                                e.target.checked
                                  ? [...a, m.member_id]
                                  : a.filter((x) => x !== m.member_id),
                              )
                            }
                          />
                          <span>
                            {m.full_name}
                            {!m.canVote && (
                              <span className="block text-xs text-ink-500">
                                Present, without voting rights
                              </span>
                            )}
                          </span>
                        </label>
                      ))}
                    </div>
                    <p className="text-sm mt-3">
                      {attendance.length} present;{" "}
                      {Math.ceil(
                        (candidates.members.length *
                          candidates.constitution.quorumPercentage) /
                          100,
                      )}{" "}
                      required for quorum. Eligible voters present:{" "}
                      {
                        candidates.members.filter(
                          (m) => m.canVote && attendance.includes(m.member_id),
                        ).length
                      }
                      .
                    </p>
                  </fieldset>
                )}
                <Button
                  variant="secondary"
                  type="submit"
                  loading={busy}
                  disabled={!candidates?.policy}
                >
                  Save meeting
                </Button>
              </fieldset>
            </form>
          </CardBody>
        </Card>
      )}
      {can("view.ledger") && <AnnualReport />}
      {meetings === null ? (
        !error && <Loading />
      ) : !meetings.length ? (
        <Empty title="No meetings recorded" />
      ) : (
        <div className="grid lg:grid-cols-[250px_1fr] gap-5">
          <Card className="self-start">
            <CardHeader title="Meeting history" />
            <div className="divide-y divide-line">
              {meetings.map((m) => (
                <button
                  key={m.meeting_id}
                  onClick={() => {
                    setSelected(m.meeting_id);
                    resetVote();
                  }}
                  className={`w-full p-4 text-left space-y-2 ${selected === m.meeting_id ? "bg-accent-50" : ""}`}
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
            <Empty title="Select a meeting" />
          ) : !detail ? (
            <Loading />
          ) : (
            <div className="space-y-5">
              <Card>
                <CardHeader
                  title={`Meeting · ${detail.meeting_date}`}
                  description={`${detail.attendance_count} of ${detail.eligible_count} active members present; ${detail.required_count} required for quorum.`}
                />
                <CardBody className="space-y-3">
                  <p className="text-sm whitespace-pre-wrap">
                    <strong>Agenda: </strong>
                    {detail.agenda}
                  </p>
                  <p className="text-sm whitespace-pre-wrap">
                    <strong>Minutes: </strong>
                    {detail.minutes}
                  </p>
                  <details>
                    <summary className="text-sm cursor-pointer">
                      Recorded attendance and voting rules
                    </summary>
                    <ul className="text-sm mt-2 mb-3">
                      {detail.attendance.map((m) => (
                        <li key={m.member_id}>{m.full_name}</li>
                      ))}
                    </ul>
                    <PolicySummary policy={detail.voting_policy} />
                  </details>
                  {!detail.voting_policy && (
                    <Alert tone="attention">
                      Historical record from the earlier implementation. It
                      remains readable; record a new meeting with confirmed
                      voting rules for further decisions.
                    </Alert>
                  )}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Resolutions" />
                {!detail.resolutions.length ? (
                  <Empty title="No resolutions" />
                ) : (
                  <CardBody className="space-y-4">
                    {detail.resolutions.map((r) => (
                      <article
                        key={r.resolution_id}
                        className="border border-line rounded p-4 space-y-3"
                      >
                        <div className="flex flex-wrap gap-2 justify-between">
                          <strong className="text-sm">{r.kind}</strong>
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
                          For {r.votes_for} · Against {r.votes_against} ·
                          Abstained {r.abstentions} · Required{" "}
                          {r.required_votes}
                        </p>
                        {r.voting_rules?.map((v) => (
                          <p key={v.name} className="text-xs">
                            {v.name}: {describeRule(v.rule)}
                          </p>
                        ))}
                        {r.kind === "Amendment" && (
                          <Changes changes={r.payload.changes} />
                        )}{" "}
                        {r.kind === "Expulsion" && (
                          <p className="text-sm">
                            Member: {r.subject_name || r.payload.memberId}
                            {r.payload.successorMemberId
                              ? ` · Replacement: ${r.successor_name || r.payload.successorMemberId}`
                              : ""}
                          </p>
                        )}
                        {detail.voting_policy &&
                          r.outcome === "Carried" &&
                          !r.applied_at &&
                          !r.payload?.exitWriteOff &&
                          can("governance.apply") && (
                            <Button
                              variant="secondary"
                              size="sm"
                              onClick={() => setConfirm(r)}
                            >
                              Give effect
                            </Button>
                          )}
                        {r.payload?.exitWriteOff && (
                          <p className="text-sm my-2">
                            Contribution debt write-off: ZAR{" "}
                            {r.payload.exitWriteOff.amount}.{" "}
                            <a className="underline" href="/exits">
                              Review and apply with the exit settlement
                            </a>
                            .
                          </p>
                        )}
                        {r.outcome === "Advisory" && (
                          <p className="text-xs">
                            Not binding: the meeting did not meet quorum.
                          </p>
                        )}
                      </article>
                    ))}
                  </CardBody>
                )}
              </Card>
              {mayRecord && detail.voting_policy && (
                <Card>
                  <CardHeader
                    title="Record the completed vote"
                    description={`${detail.voter_count} eligible voters were present. Include each voter exactly once in the totals.`}
                  />
                  <CardBody>
                    <form onSubmit={saveVote} className="space-y-4">
                      <fieldset disabled={busy} className="space-y-4">
                        <Field label="Resolution type" htmlFor="kind">
                          <Select
                            id="kind"
                            value={kind}
                            onChange={(e) => {
                              setKind(e.target.value);
                              resetVote();
                            }}
                          >
                            <option>General</option>
                            <option>Amendment</option>
                            <option>Expulsion</option>
                          </Select>
                        </Field>
                        {kind === "Amendment" ? (
                          <>
                            <Field label="Pending amendment" htmlFor="pending">
                              <Select
                                id="pending"
                                value={proposalId}
                                required
                                onChange={(e) => setProposalId(e.target.value)}
                              >
                                <option value="">
                                  Select a pending proposal
                                </option>
                                {proposals
                                  .filter((p) => p.status === "Pending")
                                  .map((p) => (
                                    <option
                                      key={p.proposal_id}
                                      value={p.proposal_id}
                                    >
                                      {p.text}
                                    </option>
                                  ))}
                              </Select>
                            </Field>
                            {chosenProposal && (
                              <div className="p-3 border border-line rounded">
                                <p className="text-sm mb-2">
                                  Exact proposal to be voted on · effective{" "}
                                  {chosenProposal.effective_date}
                                </p>
                                <Changes changes={chosenProposal.changes} />
                              </div>
                            )}
                          </>
                        ) : (
                          <Field
                            label="Resolution text and reason"
                            htmlFor="resolution-text"
                          >
                            <Textarea
                              id="resolution-text"
                              required
                              maxLength={20000}
                              value={text}
                              onChange={(e) => setText(e.target.value)}
                            />
                          </Field>
                        )}
                        {kind === "General" && (
                          <ExitWriteoffPicker
                            key={selected + refreshKey}
                            onChange={setExitWriteOff}
                          />
                        )}
                        {kind === "Expulsion" && (
                          <>
                            <Field label="Member to expel" htmlFor="member">
                              <Select
                                id="member"
                                required
                                value={memberId}
                                onChange={(e) => {
                                  setMemberId(e.target.value);
                                  setSuccessor("");
                                }}
                              >
                                <option value="">Select member</option>
                                {people.map((m) => (
                                  <option key={m.member_id} value={m.member_id}>
                                    {m.full_name} · {m.role}
                                  </option>
                                ))}
                              </Select>
                            </Field>
                            {subject && subject.role !== "Member" && (
                              <Field
                                label={`Replacement ${subject.role} named in this resolution`}
                                htmlFor="successor"
                                hint="Required when removing the last Chairperson or Treasurer. The voted replacement is appointed atomically when the resolution is applied."
                              >
                                <Select
                                  id="successor"
                                  value={successor}
                                  onChange={(e) => setSuccessor(e.target.value)}
                                >
                                  <option value="">No replacement</option>
                                  {people
                                    .filter(
                                      (m) =>
                                        m.role === "Member" &&
                                        m.standing === "Good standing" &&
                                        m.member_id !== memberId,
                                    )
                                    .map((m) => (
                                      <option
                                        key={m.member_id}
                                        value={m.member_id}
                                      >
                                        {m.full_name}
                                      </option>
                                    ))}
                                </Select>
                              </Field>
                            )}
                          </>
                        )}
                        <div className="grid grid-cols-3 gap-2">
                          {[
                            ["votesFor", "In favour"],
                            ["votesAgainst", "Against"],
                            ["abstentions", "Abstaining"],
                          ].map(([key, label]) => (
                            <Field key={key} label={label} htmlFor={key}>
                              <Input
                                id={key}
                                required
                                type="number"
                                step="1"
                                min="0"
                                max={detail.voter_count}
                                value={votes[key]}
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
                          {totalVotes} of {detail.voter_count} eligible voters
                          accounted for.
                        </p>
                        {!detail.quorate && (
                          <Alert tone="attention">
                            Any resolution recorded here will be advisory and
                            cannot be applied.
                          </Alert>
                        )}
                        <Button
                          variant="secondary"
                          type="submit"
                          loading={busy}
                          disabled={totalVotes !== detail.voter_count}
                        >
                          Record vote
                        </Button>
                      </fieldset>
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
          title="Give effect to the carried resolution?"
          description={
            confirm.kind === "Expulsion"
              ? "This ends the membership, closes its queue position and appoints any replacement named in the vote. Records are retained."
              : confirm.kind === "Amendment"
                ? "This creates a constitution version with exactly the changes and date approved by members."
                : "This records that the carried decision has been put into effect."
          }
          requireReason={false}
          confirmLabel="Give effect"
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            await governance.apply(confirm.resolution_id);
            setRefreshKey((k) => k + 1);
            setNotice("Resolution applied.");
          }}
        />
      )}
    </div>
  );
}
