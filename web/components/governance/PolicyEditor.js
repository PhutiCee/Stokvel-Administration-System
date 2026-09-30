"use client";
import { Field, Input, Select, Textarea } from "@/components/ui/Input";
import Button from "@/components/ui/Button";
export const FIELD_LABELS = {
  contributionAmount: "Contribution amount",
  cycleFrequency: "Cycle frequency",
  penaltyAmount: "Late penalty",
  gracePeriodDays: "Grace period",
  quorumPercentage: "Meeting quorum",
  exitNoticeDays: "Exit notice",
  payoutOrderMethod: "Payout order",
  forfeitureRule: "Forfeiture rule",
  waitingPeriodDays: "Burial waiting period",
  benefitSchedule: "Burial benefit schedule",
  yearEndMonth: "Year-end month",
  yearEndDay: "Year-end day",
  governancePolicy: "Voting rules and voting rights",
};
export const emptyPolicy = (fields = Object.keys(FIELD_LABELS)) => ({
  source: "",
  general: {},
  expulsion: {},
  amendmentClasses: [{ name: "", fields, rule: {} }],
});
export function RuleEditor({ value = {}, onChange, prefix }) {
  const set = (key, v) => onChange({ ...value, [key]: v });
  return (
    <div className="grid sm:grid-cols-2 gap-3">
      <Field htmlFor={`${prefix}-comparison`} label="Required proportion">
        <Select
          id={`${prefix}-comparison`}
          value={value.comparison || ""}
          required
          onChange={(e) => set("comparison", e.target.value)}
        >
          <option value="">Choose from constitution</option>
          <option value="atLeast">At least</option>
          <option value="moreThan">More than</option>
        </Select>
      </Field>
      <div className="grid grid-cols-2 gap-2">
        {["numerator", "denominator"].map((k, i) => (
          <Field
            key={k}
            htmlFor={`${prefix}-${k}`}
            label={i ? "Out of" : "Votes in favour"}
          >
            <Input
              id={`${prefix}-${k}`}
              type="number"
              min="1"
              max="10000"
              step="1"
              required
              value={value[k] ?? ""}
              onChange={(e) =>
                set(
                  k,
                  e.target.value === "" ? undefined : Number(e.target.value),
                )
              }
            />
          </Field>
        ))}
      </div>
      <Field
        htmlFor={`${prefix}-basis`}
        label="Count the proportion against"
        className="sm:col-span-2"
      >
        <Select
          id={`${prefix}-basis`}
          required
          value={value.basis || ""}
          onChange={(e) => set("basis", e.target.value)}
        >
          <option value="">Choose from constitution</option>
          <option value="present">
            Eligible voters present, including abstentions
          </option>
          <option value="cast">
            Votes cast for or against, excluding abstentions
          </option>
          <option value="eligible">All eligible voters in the club</option>
        </Select>
      </Field>
    </div>
  );
}
export function describeRule(r) {
  if (!r) return "Not configured";
  return `${r.comparison === "moreThan" ? "More than" : "At least"} ${r.numerator}/${r.denominator} of ${{ present: "eligible voters present", cast: "votes cast for or against", eligible: "all eligible club voters" }[r.basis]}`;
}
export function PolicySummary({ policy }) {
  if (!policy) return null;
  return (
    <div className="text-sm space-y-2">
      <p className="whitespace-pre-wrap">
        <strong>Constitution source: </strong>
        {policy.source}
      </p>
      <p>General decisions: {describeRule(policy.general)}</p>
      <p>Expulsion: {describeRule(policy.expulsion)}</p>
      <p>
        Voting rights: suspended members{" "}
        {policy.suspendedCanVote ? "may" : "may not"} vote; members in arrears{" "}
        {policy.arrearsCanVote ? "may" : "may not"} vote.
      </p>
      {policy.amendmentClasses.map((c) => (
        <p key={c.name}>
          <strong>{c.name}:</strong> {describeRule(c.rule)}. Applies to{" "}
          {c.fields.map((f) => FIELD_LABELS[f]).join(", ")}.
        </p>
      ))}
    </div>
  );
}
export default function PolicyEditor({
  value,
  onChange,
  prefix = "policy",
  fields = Object.keys(FIELD_LABELS),
}) {
  const set = (key, v) => onChange({ ...value, [key]: v });
  const classes = value.amendmentClasses || [];
  const updateClass = (index, patch) =>
    set(
      "amendmentClasses",
      classes.map((c, i) => (i === index ? { ...c, ...patch } : c)),
    );
  function assign(index, field, checked) {
    set(
      "amendmentClasses",
      classes.map((c, i) => ({
        ...c,
        fields:
          i === index && checked
            ? [...new Set([...c.fields, field])]
            : c.fields.filter((f) => f !== field),
      })),
    );
  }
  return (
    <div className="space-y-5">
      <Field
        label="Source clause and adopted wording"
        htmlFor={`${prefix}-source`}
        hint="Transcribe the existing constitution. Examples explain fractions; they are not recommended voting thresholds."
      >
        <Textarea
          id={`${prefix}-source`}
          required
          maxLength={4000}
          value={value.source || ""}
          onChange={(e) => set("source", e.target.value)}
        />
      </Field>
      <div className="grid sm:grid-cols-2 gap-3">
        {[
          ["suspendedCanVote", "May suspended members vote?"],
          ["arrearsCanVote", "May members in arrears vote?"],
        ].map(([key, label]) => (
          <Field key={key} label={label} htmlFor={`${prefix}-${key}`}>
            <Select
              id={`${prefix}-${key}`}
              required
              value={value[key] === undefined ? "" : String(value[key])}
              onChange={(e) =>
                set(
                  key,
                  e.target.value === "" ? undefined : e.target.value === "true",
                )
              }
            >
              <option value="">Choose from constitution</option>
              <option value="true">Yes</option>
              <option value="false">No</option>
            </Select>
          </Field>
        ))}
      </div>
      {["general", "expulsion"].map((k) => (
        <fieldset key={k} className="border border-line rounded p-4">
          <legend className="px-1 text-sm font-semibold">
            {k === "general" ? "General decisions" : "Expulsion decisions"}
          </legend>
          <RuleEditor
            prefix={`${prefix}-${k}`}
            value={value[k]}
            onChange={(v) => set(k, v)}
          />
        </fieldset>
      ))}
      <p className="text-sm text-ink-500">
        Enter each amendment class named in the constitution. Assign each
        parameter to exactly one class. A proposal spanning several classes must
        satisfy every applicable majority.
      </p>
      {classes.map((c, i) => (
        <fieldset key={i} className="border border-line rounded p-4 space-y-3">
          <legend className="px-1 text-sm font-semibold">
            Amendment class {i + 1}
          </legend>
          <Field
            label="Class name from constitution"
            htmlFor={`${prefix}-class-${i}`}
          >
            <Input
              id={`${prefix}-class-${i}`}
              required
              maxLength={80}
              value={c.name}
              onChange={(e) => updateClass(i, { name: e.target.value })}
            />
          </Field>
          <RuleEditor
            prefix={`${prefix}-class-${i}`}
            value={c.rule}
            onChange={(v) => updateClass(i, { rule: v })}
          />
          <div className="grid sm:grid-cols-2 gap-2">
            {Object.entries(FIELD_LABELS)
              .filter(([field]) => fields.includes(field))
              .map(([field, label]) => (
                <label key={field} className="flex gap-2 items-start text-sm">
                  <input
                    className="mt-1"
                    type="checkbox"
                    checked={c.fields.includes(field)}
                    onChange={(e) => assign(i, field, e.target.checked)}
                  />
                  {label}
                </label>
              ))}
          </div>
          {classes.length > 1 && (
            <Button
              type="button"
              variant="ghost"
              onClick={() =>
                set(
                  "amendmentClasses",
                  classes.filter((_, n) => n !== i),
                )
              }
            >
              Remove class
            </Button>
          )}
        </fieldset>
      ))}
      <Button
        type="button"
        variant="secondary"
        onClick={() =>
          set("amendmentClasses", [
            ...classes,
            { name: "", fields: [], rule: {} },
          ])
        }
      >
        Add amendment class
      </Button>
    </div>
  );
}
