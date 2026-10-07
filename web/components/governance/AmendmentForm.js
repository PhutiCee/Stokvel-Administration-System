"use client";
import { useState } from "react";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import PolicyEditor, { FIELD_LABELS, emptyPolicy } from "./PolicyEditor";
export default function AmendmentForm({
  clubType,
  currentPolicy,
  policyFields,
  onSubmit,
  busy,
  today,
}) {
  const [text, setText] = useState(""),
    [date, setDate] = useState(""),
    [changes, setChanges] = useState({}),
    [changePolicy, setChangePolicy] = useState(false),
    [policy, setPolicy] = useState(() => currentPolicy || emptyPolicy());
  const set = (key, value) => setChanges((c) => ({ ...c, [key]: value }));
  const numeric = [
    "warningAfterMissed", "suspensionAfterMissed", "expulsionAfterMissed",
    "contributionAmount",
    "penaltyAmount",
    "gracePeriodDays",
    "quorumPercentage",
    "exitNoticeDays",
    ...(clubType === "Burial" ? ["waitingPeriodDays"] : []),
    ...(clubType === "Accumulating" ? ["yearEndMonth", "yearEndDay"] : []),
  ];
  async function submit(e) {
    e.preventDefault();
    const data = Object.fromEntries(
      Object.entries(changes).filter(([, v]) => v !== ""),
    );
    if (data.benefitSchedule)
      data.benefitSchedule = data.benefitSchedule
        .split("\n")
        .filter((l) => l.trim())
        .map((line) => {
          const [category, amount] = line.split(":");
          return { category: category?.trim(), amount: amount?.trim() };
        });
    if (changePolicy) data.governancePolicy = policy;
    const success = await onSubmit({
      text,
      effectiveDate: date,
      changes: data,
    });
    if (success) {
      setText("");
      setChanges({});
      setDate("");
      setChangePolicy(false);
    }
  }
  return (
    <form onSubmit={submit} className="space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        <Field label="Proposed amendment and reason" htmlFor="proposal-text">
          <Textarea
            id="proposal-text"
            required
            maxLength={20000}
            value={text}
            onChange={(e) => setText(e.target.value)}
          />
        </Field>
        <Field
          label="Proposed effective date"
          htmlFor="proposal-date"
          hint="Choose time for the meeting, vote and application. A passed proposal cannot be applied after its effective date has passed."
        >
          <Input
            id="proposal-date"
            required
            type="date"
            min={today}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </Field>
        <p className="text-sm text-ink-500">
          Fill only parameters being changed. Financial rules apply to cycles
          commencing after the effective date.
        </p>
        <div className="grid sm:grid-cols-2 gap-3">
          {numeric.map((k) => (
            <Field key={k} label={FIELD_LABELS[k]} htmlFor={`change-${k}`}>
              <Input
                id={`change-${k}`}
                type="number"
                min="0"
                step={k.endsWith("Amount") ? "0.01" : "1"}
                value={changes[k] ?? ""}
                onChange={(e) => set(k, e.target.value)}
              />
            </Field>
          ))}
        </div>
        <Field label="Cycle frequency" htmlFor="change-frequency">
          <Select
            id="change-frequency"
            value={changes.cycleFrequency || ""}
            onChange={(e) => set("cycleFrequency", e.target.value)}
          >
            <option value="">Keep existing</option>
            <option>Weekly</option>
            <option>Fortnightly</option>
            <option>Monthly</option>
          </Select>
        </Field>
        <Field label="Forfeiture rule" htmlFor="change-forfeiture">
          <Textarea
            id="change-forfeiture"
            value={changes.forfeitureRule || ""}
            onChange={(e) => set("forfeitureRule", e.target.value)}
          />
        </Field>
        {clubType === "Rotating" && (
          <Field label="Payout order" htmlFor="change-order">
            <Select
              id="change-order"
              value={changes.payoutOrderMethod || ""}
              onChange={(e) => set("payoutOrderMethod", e.target.value)}
            >
              <option value="">Keep existing</option>
              <option>Random draw</option>
              <option>Seniority</option>
              <option>Negotiated</option>
            </Select>
          </Field>
        )}
        {clubType === "Burial" && (
          <Field
            label="Full replacement benefit schedule"
            htmlFor="change-benefits"
            hint="One category and amount per line, e.g. Spouse: 10000."
          >
            <Textarea
              id="change-benefits"
              value={changes.benefitSchedule || ""}
              onChange={(e) => set("benefitSchedule", e.target.value)}
            />
          </Field>
        )}
        <label className="flex gap-2 text-sm">
          <input
            type="checkbox"
            checked={changePolicy}
            onChange={(e) => setChangePolicy(e.target.checked)}
          />
          Propose changes to voting rules or voting rights
        </label>
        {changePolicy && (
          <PolicyEditor
            fields={policyFields}
            prefix="amendment-policy"
            value={policy}
            onChange={setPolicy}
          />
        )}
        <Button type="submit" variant="secondary" loading={busy}>
          Submit pending proposal
        </Button>
      </fieldset>
    </form>
  );
}
