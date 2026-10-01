"use client";
import { todayIso } from "@/lib/format";

/**
 * Burial claims. Use Case 4. REQ-37, REQ-83 to REQ-88.
 *
 * Two audiences share this screen. Every member manages their own covered
 * dependants and can lodge a claim on one of them. Officers additionally see
 * every claim in the club and act on the ones waiting for payment — strictly
 * in the order they were lodged (REQ-88), which the screen makes visible
 * rather than just enforcing silently.
 */

import { useEffect, useState, useCallback } from "react";
import { AlertCircle, HeartHandshake, Users, Plus, Check, X, Clock } from "lucide-react";
import { PageHeader } from "@/components/shell/ClubShell";
import Button from "@/components/ui/Button";
import { Input, Select, Textarea, Field } from "@/components/ui/Input";
import { Card, Badge, Alert, Loading, Empty } from "@/components/ui/States";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import { useSession } from "@/lib/session";
import { claims as api, clubs as clubsApi, ApiError } from "@/lib/api";
import { money, fmtDate, cx } from "@/lib/format";

const STATUS_TONE = { Lodged: "attention", Initiated: "accent", Approved: "positive", Cancelled: "neutral" };

export default function ClaimsPage() {
  const { club, can, membership } = useSession();
  const [claims, setClaims] = useState(null);
  const [dependants, setDependants] = useState(null);
  const [constitution, setConstitution] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [registering, setRegistering] = useState(false);
  const [lodging, setLodging] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [cancelling, setCancelling] = useState(null);

  const isOfficer = can("claim.view");

  const load = useCallback(async (signal) => {
    try {
      const [c, d, con] = await Promise.all([
        isOfficer ? api.list({ signal }) : api.mine({ signal }),
        api.myDependants({ signal }),
        clubsApi.constitution()
      ]);
      setClaims(c.claims);
      setDependants(d.dependants);
      setConstitution(con.constitution);
      setError(null);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Could not load claims.");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOfficer]);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  async function act(fn) {
    setBusy(true);
    setError(null);
    try {
      await fn();
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  if (club?.clubType !== "Burial") {
    return (
      <>
        <PageHeader title="Claims" />
        <Card>
          <Empty icon={HeartHandshake} title="Not applicable to this club">
            Only a burial society pays a claim on a covered dependant&rsquo;s death.
          </Empty>
        </Card>
      </>
    );
  }

  if (error && !claims) {
    return <Alert tone="exception" icon={AlertCircle} title="Could not load claims">{error}</Alert>;
  }
  if (!claims) return <Loading label="Loading claims" />;

  const oldestLodged = [...claims].filter((c) => c.status === "Lodged").sort((a, b) => new Date(a.lodged.at) - new Date(b.lodged.at))[0];

  return (
    <>
      <PageHeader
        title="Burial claims"
        description="Claims are paid strictly in the order they were lodged. If the pool cannot cover the next one, it is refused rather than part-paid."
        action={
          can("claim.lodge") && (
            <Button onClick={() => setLodging(true)} disabled={!dependants?.length}>
              <Plus size={14} aria-hidden /> Lodge a claim
            </Button>
          )
        }
      />

      {error && <Alert tone="exception" icon={AlertCircle} className="mb-5">{error}</Alert>}

      <div className="mb-8">
        <div className="flex items-center justify-between gap-3 mb-3">
          <h2 className="text-sm font-semibold text-ink-900">My dependants</h2>
          {can("dependant.manage") && (
            <Button size="sm" variant="secondary" onClick={() => setRegistering(true)}>
              <Plus size={13} aria-hidden /> Add a dependant
            </Button>
          )}
        </div>
        {!dependants?.length ? (
          <Card><Empty icon={Users} title="No dependants recorded yet" /></Card>
        ) : (
          <ul className="grid sm:grid-cols-2 gap-2">
            {dependants.map((d) => (
              <li key={d.dependantId}>
                <Card className={cx("p-3 flex items-center justify-between gap-2", d.removedAt && "opacity-50")}>
                  <div className="min-w-0">
                    <p className="text-[13.5px] text-ink-900 truncate">{d.name}</p>
                    <p className="text-[12px] text-ink-500">{d.category}{d.removedAt ? " · cover ended" : ""}</p>
                  </div>
                </Card>
              </li>
            ))}
          </ul>
        )}
      </div>

      <h2 className="text-sm font-semibold text-ink-900 mb-3">{isOfficer ? "All claims" : "My claims"}</h2>
      {claims.length === 0 ? (
        <Card><Empty icon={HeartHandshake} title="No claims lodged yet" /></Card>
      ) : (
        <ul className="space-y-2">
          {claims.map((c) => (
            <ClaimCard
              key={c.claimId}
              claim={c}
              can={can}
              busy={busy}
              isOldestLodged={oldestLodged?.claimId === c.claimId}
              onInitiate={() => setConfirmation({ title: "Initiate claim payment", description: "Submit this claim for payment approval by a different officer?", run: () => api.initiate(c.claimId) })}
              onApprove={() => setConfirmation({ title: "Approve claim payment", description: "Pay the assessed benefit for this claim and record it in the ledger?", run: () => api.approve(c.claimId) })}
              onCancel={() => setCancelling(c)}
            />
          ))}
        </ul>
      )}

      {registering && (
        <RegisterDependantDialog
          categories={constitution?.benefitSchedule?.map((r) => r.category) || []}
          onClose={() => setRegistering(false)}
          onSubmit={(details) => act(() => api.registerDependant(details))}
        />
      )}

      {lodging && (
        <LodgeClaimDialog
          dependants={dependants.filter((d) => !d.removedAt)}
          onClose={() => setLodging(false)}
          onSubmit={(details) => act(() => api.lodge(details))}
        />
      )}

      {confirmation && <ConfirmDialog title={confirmation.title} description={confirmation.description}
        requireReason={false} confirmVariant="primary" onClose={() => setConfirmation(null)}
        onConfirm={async () => { await confirmation.run(); await load(); }} />}
      {cancelling && (
        <ConfirmDialog
          title="Cancel this claim"
          description={`This withdraws the claim on ${cancelling.dependant.name}. A fresh claim can be lodged for them again later.`}
          confirmLabel="Cancel the claim"
          onClose={() => setCancelling(null)}
          onConfirm={(reason) => act(() => api.cancel(cancelling.claimId, reason))}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------

function ClaimCard({ claim, can, busy, isOldestLodged, onInitiate, onApprove, onCancel }) {
  return (
    <li>
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="text-[14px] text-ink-900">
              {claim.dependant.name} <span className="text-ink-500 font-normal">({claim.dependant.category})</span>
            </p>
            <p className="text-[12.5px] text-ink-500 mt-0.5">
              Claimant {claim.claimant.fullName} · Died {fmtDate(claim.dateOfDeath)} · Lodged {fmtDate(claim.lodged.at)}
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className="font-mono tnum text-[16px] font-medium text-ink-900">{money(claim.benefitAmount)}</p>
            <Badge tone={STATUS_TONE[claim.status]}>{claim.status}</Badge>
          </div>
        </div>

        {claim.description && <p className="mt-2 text-[13px] text-ink-500">{claim.description}</p>}

        {claim.paymentAssessment && !claim.paymentAssessment.eligible && (
          <div className="mt-3 space-y-2">
            {claim.paymentAssessment.refusals.map((r, i) => (
              <Alert key={i} tone={r.code === "OUT_OF_ORDER" ? "attention" : "exception"} icon={r.code === "OUT_OF_ORDER" ? Clock : AlertCircle}>
                {r.message}
              </Alert>
            ))}
          </div>
        )}

        {claim.cancelled?.reason && (
          <p className="mt-2 text-[12.5px] text-exc-700">Reason: {claim.cancelled.reason}</p>
        )}

        <div className="flex gap-2 mt-3">
          {claim.status === "Lodged" && can("claim.initiate") && (
            <Button size="sm" onClick={onInitiate} loading={busy} disabled={!isOldestLodged}>
              Initiate payment
            </Button>
          )}
          {claim.status === "Initiated" && can("claim.approve") && (
            <Button size="sm" onClick={onApprove} loading={busy}>
              <Check size={13} aria-hidden /> Approve
            </Button>
          )}
          {["Lodged", "Initiated"].includes(claim.status) && can("claim.cancel") && (
            <Button size="sm" variant="secondary" onClick={onCancel} disabled={busy}>
              <X size={13} aria-hidden /> Cancel
            </Button>
          )}
        </div>
      </Card>
    </li>
  );
}

function RegisterDependantDialog({ categories, onClose, onSubmit }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState(categories[0] || "");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ name, category, dateOfBirth: dateOfBirth || null });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-5" role="dialog" aria-modal="true" aria-label="Add a dependant">
      <Card className="w-full max-w-md p-5 shadow-pop animate-slideUp">
        <h2 className="text-sm font-semibold text-ink-900">Add a covered dependant</h2>
        <div className="mt-4 space-y-4">
          <Field label="Name" htmlFor="name" required>
            <Input id="name" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </Field>
          <Field label="Category" htmlFor="category" required hint="From the constitution's benefit schedule.">
            <Select id="category" value={category} onChange={(e) => setCategory(e.target.value)}>
              {categories.length === 0 && <option value="">No categories set</option>}
              {categories.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          </Field>
          <Field label="Date of birth" htmlFor="dob" hint="Optional.">
            <Input id="dob" type="date" value={dateOfBirth} onChange={(e) => setDateOfBirth(e.target.value)} />
          </Field>
        </div>
        {error && <Alert tone="exception" icon={AlertCircle} className="mt-3">{error}</Alert>}
        <div className="mt-5 flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Never mind</Button>
          <Button onClick={submit} loading={busy} disabled={!name.trim() || !category}>Add dependant</Button>
        </div>
      </Card>
    </div>
  );
}

function LodgeClaimDialog({ dependants, onClose, onSubmit }) {
  const [dependantId, setDependantId] = useState(dependants[0]?.dependantId || "");
  const [dateOfDeath, setDateOfDeath] = useState(todayIso());
  const [description, setDescription] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ dependantId, dateOfDeath, description: description || null });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-5" role="dialog" aria-modal="true" aria-label="Lodge a claim">
      <Card className="w-full max-w-md p-5 shadow-pop animate-slideUp">
        <h2 className="text-sm font-semibold text-ink-900">Lodge a claim</h2>
        <p className="mt-1.5 text-[13px] text-ink-500 leading-relaxed">
          The benefit amount is set by the dependant&rsquo;s category in the constitution in force on the date of death.
        </p>

        <div className="mt-4 space-y-4">
          <Field label="Dependant" htmlFor="dependant" required>
            <Select id="dependant" value={dependantId} onChange={(e) => setDependantId(e.target.value)}>
              {dependants.length === 0 && <option value="">No dependants recorded</option>}
              {dependants.map((d) => (
                <option key={d.dependantId} value={d.dependantId}>{d.name} ({d.category})</option>
              ))}
            </Select>
          </Field>
          <Field label="Date of death" htmlFor="dateOfDeath" required>
            <Input id="dateOfDeath" type="date" value={dateOfDeath} onChange={(e) => setDateOfDeath(e.target.value)} />
          </Field>
          <Field label="Description" htmlFor="description" hint="Supporting documentation, as a reference or note.">
            <Textarea id="description" value={description} onChange={(e) => setDescription(e.target.value)} />
          </Field>
        </div>

        {error && <Alert tone="exception" icon={AlertCircle} className="mt-3">{error}</Alert>}

        <div className="mt-5 flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Never mind</Button>
          <Button onClick={submit} loading={busy} disabled={!dependantId}>Lodge claim</Button>
        </div>
      </Card>
    </div>
  );
}