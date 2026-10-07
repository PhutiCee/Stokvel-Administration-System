"use client";
import { useState } from "react";
import { AlertCircle, Plus } from "lucide-react";
import Button from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import { Card, Alert } from "@/components/ui/States";
import { ApiError } from "@/lib/api";
import { todayIso } from "@/lib/format";
import FoundingMembers from "./FoundingMembers";
import { emptyPerson } from "./PersonFields";
const CLUB_TYPES = ["Rotating", "Accumulating", "Burial"];
const FREQUENCIES = ["Weekly", "Fortnightly", "Monthly"];
const ORDER_METHODS = ["Random draw", "Seniority", "Negotiated"];

const EMPTY = {
  name: "",
  shortName: "",
  clubType: "Rotating",
  town: "",
  contributionAmount: "",
  cycleFrequency: "Monthly",
  cycleStartDate: todayIso(),
  yearEndMonth: 12,
  yearEndDay: 31,
  penaltyAmount: "",
  gracePeriodDays: 5,
  quorumPercentage: 50,
  exitNoticeDays: 30,
  payoutOrderMethod: "Random draw",
  forfeitureRule: "",
  waitingPeriodDays: 180,
  benefitSchedule: [{ category: "Principal member", amount: "" }],
  chairperson: {
    fullName: "",
    phone: "",
    idNumber: "",
    email: "",
    postalAddress: "",
  },
};

export default function ClubForm({ onCancel, onDone, submitClub, selfChairperson = false, applicant }) {
  const [form, setForm] = useState(() => ({...EMPTY, applicantRole:'Chairperson', foundingMembers:['Treasurer','Secretary','Member'].map(role => ({...emptyPerson(),role}))}));
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => {
    setForm((f) => ({ ...f, [k]: e.target.value }));
    setFields((f) => ({ ...f, [k]: undefined }));
  };
  const setChair = (k) => (e) =>
    setForm((f) => ({
      ...f,
      chairperson: { ...f.chairperson, [k]: e.target.value },
    }));

  const setBenefit = (i, k) => (e) =>
    setForm((f) => {
      const schedule = [...f.benefitSchedule];
      schedule[i] = { ...schedule[i], [k]: e.target.value };
      return { ...f, benefitSchedule: schedule };
    });

  async function submit() {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      await onDone(await submitClub(form));
    } catch (err) {
      if (err instanceof ApiError && err.detail?.fields) {
        setFields(err.detail.fields);
        setError(selfChairperson && Object.keys(err.detail.fields).some(k => k.startsWith("chairperson."))
          ? "Your existing account needs a valid phone number and an email or postal address before you can create a club."
          : err.message);
      } else setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="max-w-2xl">
      <Card className="p-5 space-y-5">
        <div>
          <h2 className="text-sm font-semibold text-ink-900">The club</h2>
          <div className="mt-3 grid sm:grid-cols-2 gap-4">
            <Field
              label="Full name"
              htmlFor="name"
              required
              error={fields.name}
              className="sm:col-span-2"
            >
              <Input
                id="name"
                value={form.name}
                onChange={set("name")}
                invalid={!!fields.name}
              />
            </Field>
            <Field
              label="Short name"
              htmlFor="shortName"
              required
              error={fields.shortName}
              hint="For headings and lists."
            >
              <Input
                id="shortName"
                value={form.shortName}
                onChange={set("shortName")}
                invalid={!!fields.shortName}
              />
            </Field>
            <Field label="Town" htmlFor="town">
              <Input id="town" value={form.town} onChange={set("town")} />
            </Field>
            <Field label="Type" htmlFor="clubType" error={fields.clubType}>
              <Select
                id="clubType"
                value={form.clubType}
                onChange={set("clubType")}
              >
                {CLUB_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>

        <div className="pt-4 border-t border-line">
          <h2 className="text-sm font-semibold text-ink-900">
            The constitution
          </h2>
          <p className="text-[12.5px] text-ink-500 mt-0.5">
            Version 1, as adopted at formation. Amendments create new versions
            rather than changing this one.
          </p>

          <div className="mt-3 grid sm:grid-cols-2 gap-4">
            <Field
              label="Contribution"
              htmlFor="contributionAmount"
              required
              error={fields.contributionAmount}
            >
              <Input
                id="contributionAmount"
                inputMode="decimal"
                className="font-mono tnum"
                value={form.contributionAmount}
                onChange={set("contributionAmount")}
                invalid={!!fields.contributionAmount}
              />
            </Field>
            <Field
              label="How often"
              htmlFor="cycleFrequency"
              error={fields.cycleFrequency}
            >
              <Select
                id="cycleFrequency"
                value={form.cycleFrequency}
                onChange={set("cycleFrequency")}
              >
                {FREQUENCIES.map((f) => (
                  <option key={f} value={f}>
                    {f}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="First cycle start date" htmlFor="cycleStartDate" error={fields.cycleStartDate}>
              <Input id="cycleStartDate" type="date" value={form.cycleStartDate} onChange={set("cycleStartDate")} />
            </Field>
            {form.clubType === "Accumulating" && <>
              <Field label="Year-end month" htmlFor="yearEndMonth" error={fields.yearEndMonth}>
                <Input id="yearEndMonth" type="number" min="1" max="12" value={form.yearEndMonth} onChange={set("yearEndMonth")} />
              </Field>
              <Field label="Year-end day" htmlFor="yearEndDay" error={fields.yearEndDay}>
                <Input id="yearEndDay" type="number" min="1" max="31" value={form.yearEndDay} onChange={set("yearEndDay")} />
              </Field>
            </>}
            <Field
              label="Late penalty"
              htmlFor="penaltyAmount"
              error={fields.penaltyAmount}
            >
              <Input
                id="penaltyAmount"
                inputMode="decimal"
                className="font-mono tnum"
                value={form.penaltyAmount}
                onChange={set("penaltyAmount")}
                invalid={!!fields.penaltyAmount}
              />
            </Field>
            <Field
              label="Grace period (days)"
              htmlFor="gracePeriodDays"
              error={fields.gracePeriodDays}
              hint="Must be shorter than one cycle."
            >
              <Input
                id="gracePeriodDays"
                type="number"
                min="0"
                className="font-mono tnum"
                value={form.gracePeriodDays}
                onChange={set("gracePeriodDays")}
                invalid={!!fields.gracePeriodDays}
              />
            </Field>
            <Field
              label="Quorum (%)"
              htmlFor="quorumPercentage"
              error={fields.quorumPercentage}
            >
              <Input
                id="quorumPercentage"
                type="number"
                min="1"
                max="100"
                className="font-mono tnum"
                value={form.quorumPercentage}
                onChange={set("quorumPercentage")}
                invalid={!!fields.quorumPercentage}
              />
            </Field>
            <Field
              label="Exit notice (days)"
              htmlFor="exitNoticeDays"
              error={fields.exitNoticeDays}
            >
              <Input
                id="exitNoticeDays"
                type="number"
                min="0"
                className="font-mono tnum"
                value={form.exitNoticeDays}
                onChange={set("exitNoticeDays")}
              />
            </Field>

            {form.clubType === "Rotating" && (
              <Field
                label="Payout order"
                htmlFor="payoutOrderMethod"
                error={fields.payoutOrderMethod}
                className="sm:col-span-2"
              >
                <Select
                  id="payoutOrderMethod"
                  value={form.payoutOrderMethod}
                  onChange={set("payoutOrderMethod")}
                >
                  {ORDER_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </Select>
              </Field>
            )}

            {form.clubType === "Burial" && (
              <>
                <Field
                  label="Waiting period (days)"
                  htmlFor="waitingPeriodDays"
                  error={fields.waitingPeriodDays}
                  hint="Before a claim may be lodged."
                >
                  <Input
                    id="waitingPeriodDays"
                    type="number"
                    min="0"
                    className="font-mono tnum"
                    value={form.waitingPeriodDays}
                    onChange={set("waitingPeriodDays")}
                  />
                </Field>
                <div className="sm:col-span-2">
                  <p className="text-[13px] font-medium text-ink-700 mb-2">
                    Benefit schedule
                    <span className="text-exc-600 ml-0.5" aria-hidden>
                      *
                    </span>
                  </p>
                  {form.benefitSchedule.map((row, i) => (
                    <div key={i} className="grid grid-cols-2 gap-3 mb-2">
                      <Input
                        aria-label="Category"
                        placeholder="Category, e.g. Spouse"
                        value={row.category}
                        onChange={setBenefit(i, "category")}
                      />
                      <Input
                        aria-label="Benefit amount"
                        inputMode="decimal"
                        className="font-mono tnum"
                        placeholder="Amount"
                        value={row.amount}
                        onChange={setBenefit(i, "amount")}
                      />
                    </div>
                  ))}
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() =>
                      setForm((f) => ({
                        ...f,
                        benefitSchedule: [
                          ...f.benefitSchedule,
                          { category: "", amount: "" },
                        ],
                      }))
                    }
                  >
                    <Plus size={13} aria-hidden />
                    Add a category
                  </Button>
                  {fields.benefitSchedule && (
                    <p className="text-[12px] text-exc-600 mt-1.5">
                      {fields.benefitSchedule}
                    </p>
                  )}
                </div>
              </>
            )}

            <Field
              label="Forfeiture rule on exit"
              htmlFor="forfeitureRule"
              className="sm:col-span-2"
            >
              <Textarea
                id="forfeitureRule"
                value={form.forfeitureRule}
                onChange={set("forfeitureRule")}
                placeholder="What a member forfeits if they leave early."
              />
            </Field>
          </div>
        </div>

        {selfChairperson ? <FoundingMembers form={form} setForm={setForm} applicant={applicant} /> : <div className="pt-4 border-t border-line">
          <h2 className="text-sm font-semibold text-ink-900">
            The founding chairperson
          </h2>
          <p className="text-[12.5px] text-ink-500 mt-0.5">
            A club must have a chairperson at all times, so one is appointed
            now. They will register the rest of the members themselves.
          </p>

          <div className="mt-3 grid sm:grid-cols-2 gap-4">
            <Field
              label="Full name"
              htmlFor="chairName"
              required
              error={fields["chairperson.fullName"]}
            >
              <Input
                id="chairName"
                value={form.chairperson.fullName}
                onChange={setChair("fullName")}
                invalid={!!fields["chairperson.fullName"]}
              />
            </Field>
            <Field
              label="Phone number"
              htmlFor="chairPhone"
              required
              error={fields["chairperson.phone"]}
            >
              <Input
                id="chairPhone"
                type="tel"
                placeholder="082 444 8899"
                value={form.chairperson.phone}
                onChange={setChair("phone")}
                invalid={!!fields["chairperson.phone"]}
              />
            </Field>
            <Field label="Identity number" htmlFor="chairId">
              <Input
                id="chairId"
                inputMode="numeric"
                className="font-mono tnum"
                value={form.chairperson.idNumber}
                onChange={setChair("idNumber")}
              />
            </Field>
            <Field
              label="Email"
              htmlFor="chairEmail"
              error={fields["chairperson.email"]}
            >
              <Input
                id="chairEmail"
                type="email"
                value={form.chairperson.email}
                onChange={setChair("email")}
                invalid={!!fields["chairperson.email"]}
              />
            </Field>
            <Field
              label="Postal address"
              htmlFor="chairPostal"
              className="sm:col-span-2"
              hint="An email address or a postal address is required."
            >
              <Input
                id="chairPostal"
                value={form.chairperson.postalAddress}
                onChange={setChair("postalAddress")}
              />
            </Field>
          </div>
        </div>}
      </Card>

      {error && (
        <Alert tone="exception" icon={AlertCircle} className="mt-4">
          {error}
          {fields.foundingMembers && <p>{fields.foundingMembers}</p>}
          {Object.entries(fields).filter(([k]) => k.startsWith('foundingMembers.')).map(([k,v]) => <p key={k}>{v}</p>)}
        </Alert>
      )}

      <div className="mt-5 flex gap-3">
        <Button onClick={submit} loading={busy}>
          {selfChairperson ? "Submit club for admin approval" : "Provision the club"}
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
