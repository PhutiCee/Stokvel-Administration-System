"use client";

/**
 * The member register. REQ-34 to REQ-43, REQ-49.
 *
 * Registration is two steps, because REQ-41 requires the catch-up obligation to
 * be presented before membership is confirmed. The officer fills the form,
 * sees exactly what the new member will owe and where they land in the queue,
 * reads it to them, and only then confirms. Nothing is written until they do.
 */

import { useEffect, useState, useCallback } from "react";
import { AlertCircle, UserPlus, Users, Check, Copy, ArrowLeft } from "lucide-react";
import { PageHeader } from "@/components/shell/ClubShell";
import Button from "@/components/ui/Button";
import { Input, Select, Field } from "@/components/ui/Input";
import { Card, Badge, StandingBadge, Alert, Loading, Empty } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { members as api, ApiError } from "@/lib/api";
import { money, isZeroAmount, fmtDate, fmtPhone, maskId, initials, cx } from "@/lib/format";

const ROLES = ["Member", "Secretary", "Treasurer", "Chairperson"];

const EMPTY = {
  fullName: "", idNumber: "", phone: "", email: "", postalAddress: "",
  role: "Member", joinDate: new Date().toISOString().slice(0, 10),
  nextOfKin: { name: "", relationship: "", phone: "" }
};

export default function MembersPage() {
  const { can, role: myRole } = useSession();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [registering, setRegistering] = useState(false);
  const [changingRole, setChangingRole] = useState(null);

  const load = useCallback(async (signal) => {
    try {
      setData(await api.list({ signal }));
      setError(null);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Could not load the register.");
    }
  }, []);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  async function changeRole(memberId, role) {
    setChangingRole(memberId);
    setError(null);
    try {
      await api.assignRole(memberId, role);
      await load();
    } catch (err) {
      setError(err.message);
    } finally {
      setChangingRole(null);
    }
  }

  if (error && !data) {
    return (
      <Alert tone="exception" icon={AlertCircle} title="Could not load the register">
        {error}
      </Alert>
    );
  }
  if (!data) return <Loading label="Loading the register" />;

  if (registering) {
    return (
      <RegisterMember
        onCancel={() => setRegistering(false)}
        onDone={async () => {
          setRegistering(false);
          await load();
        }}
      />
    );
  }

  return (
    <>
      <PageHeader
        title="Members"
        description={`${data.members.length} member${data.members.length === 1 ? "" : "s"} on the register.`}
        action={
          can("member.register") && (
            <Button onClick={() => setRegistering(true)}>
              <UserPlus size={15} aria-hidden />
              Register a member
            </Button>
          )
        }
      />

      {error && (
        <Alert tone="exception" icon={AlertCircle} className="mb-5">
          {error}
        </Alert>
      )}

      {data.members.length === 0 ? (
        <Card>
          <Empty icon={Users} title="Nobody is registered yet">
            A club&rsquo;s secretary or chairperson registers its members.
          </Empty>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px] border-collapse min-w-[680px]">
              <thead>
                <tr className="bg-canvas/70 border-b border-line text-ink-500 text-left">
                  <th scope="col" className="font-medium px-5 py-2.5">Member</th>
                  <th scope="col" className="font-medium py-2.5">Role</th>
                  <th scope="col" className="font-medium py-2.5">Standing</th>
                  <th scope="col" className="font-medium py-2.5 text-right">Owes</th>
                  <th scope="col" className="font-medium px-5 py-2.5 text-right">Joined</th>
                </tr>
              </thead>
              <tbody>
                {data.members.map((m) => {
                  const owes = !isZeroAmount(m.outstanding);
                  return (
                    <tr key={m.memberId} className="border-b border-line last:border-0">
                      <td className="px-5 py-3">
                        <div className="flex items-center gap-3 min-w-0">
                          <span
                            className="shrink-0 grid place-items-center w-8 h-8 rounded-full bg-navy-950 text-white text-[11px] font-semibold"
                            aria-hidden
                          >
                            {initials(m.fullName)}
                          </span>
                          <div className="min-w-0">
                            <p className="font-medium text-ink-900 truncate">{m.fullName}</p>
                            <p className="text-[12px] text-ink-500 font-mono tnum">
                              {fmtPhone(m.phone)}
                              {m.queuePosition != null && ` · queue #${m.queuePosition}`}
                            </p>
                          </div>
                        </div>
                      </td>

                      <td className="py-3">
                        {can("member.assignRole") ? (
                          <Select
                            aria-label={`Role for ${m.fullName}`}
                            value={m.role}
                            disabled={changingRole === m.memberId || m.standing === "Exited"}
                            onChange={(e) => changeRole(m.memberId, e.target.value)}
                            className="h-8 text-[13px] w-[136px]"
                          >
                            {ROLES.map((r) => (
                              <option key={r} value={r}>{r}</option>
                            ))}
                          </Select>
                        ) : (
                          <Badge tone={m.role === "Member" ? "neutral" : "accent"}>{m.role}</Badge>
                        )}
                      </td>

                      <td className="py-3">
                        <StandingBadge standing={m.standing} />
                      </td>

                      <td
                        className={cx(
                          "py-3 text-right font-mono tnum",
                          owes ? "text-exc-700 font-medium" : "text-ink-400"
                        )}
                      >
                        {money(m.outstanding)}
                      </td>

                      <td className="px-5 py-3 text-right text-ink-500 whitespace-nowrap">
                        {fmtDate(m.joinDate)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="mt-5 text-[13px] text-ink-500 leading-relaxed">
        {data.canRevealIdNumbers
          ? "You hold the Secretary's role, so identity numbers are visible to you. They are masked for every other role."
          : `Identity numbers are masked. Only the Secretary and the member themselves may see them in full. Your role is ${myRole}.`}
      </p>
    </>
  );
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

function RegisterMember({ onCancel, onDone }) {
  const [form, setForm] = useState(EMPTY);
  const [fields, setFields] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [result, setResult] = useState(null);
  const [copied, setCopied] = useState(false);

  const set = (key) => (e) => {
    setForm((f) => ({ ...f, [key]: e.target.value }));
    setFields((f) => ({ ...f, [key]: undefined }));
    setError(null);
  };

  const setKin = (key) => (e) =>
    setForm((f) => ({ ...f, nextOfKin: { ...f.nextOfKin, [key]: e.target.value } }));

  async function check() {
    setBusy(true);
    setError(null);
    setFields({});
    try {
      setPreview(await api.preview(form));
    } catch (err) {
      if (err instanceof ApiError && err.detail?.fields) setFields(err.detail.fields);
      else setError(err.message);
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    setBusy(true);
    setError(null);
    try {
      setResult(await api.register(form));
    } catch (err) {
      setError(err.message);
      setPreview(null);
    } finally {
      setBusy(false);
    }
  }

  // --- done ----------------------------------------------------------------
  if (result) {
    return (
      <div className="max-w-lg">
        <PageHeader title="Member registered" description={`${form.fullName} is now on the register.`} />

        <Card className="p-5">
          <div className="flex items-start gap-3">
            <span className="grid place-items-center w-9 h-9 rounded-full bg-pos-50 text-pos-700 shrink-0">
              <Check size={18} aria-hidden />
            </span>
            <div className="min-w-0">
              <p className="text-[14px] font-medium text-ink-900">
                {result.reusedAccount
                  ? "Their existing account was reused"
                  : "A new account was created"}
              </p>
              <p className="mt-1 text-[13px] text-ink-500 leading-relaxed">
                {result.reusedAccount
                  ? "This person already belonged to another club, so they keep one account and one password across both."
                  : "They sign in with their phone number and the temporary password below."}
              </p>
            </div>
          </div>

          {result.temporaryPassword && (
            <div className="mt-5 rounded-lg border border-warn-600/25 bg-warn-50 p-4">
              <p className="text-[12.5px] font-semibold text-warn-700">
                Temporary password — shown once
              </p>
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 font-mono text-[15px] text-ink-900 bg-white rounded border border-line px-3 py-2 select-all">
                  {result.temporaryPassword}
                </code>
                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    navigator.clipboard?.writeText(result.temporaryPassword);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  }}
                >
                  {copied ? <Check size={14} /> : <Copy size={14} />}
                  {copied ? "Copied" : "Copy"}
                </Button>
              </div>
              <p className="mt-2 text-[12px] text-warn-700 leading-relaxed">
                Give this to {form.fullName.split(" ")[0]} now. It is not stored anywhere it can be
                read back — if it is lost, it has to be reset.
              </p>
            </div>
          )}

          {result.queuePosition != null && (
            <p className="mt-4 text-[13px] text-ink-500">
              Placed at queue position{" "}
              <strong className="font-mono tnum text-ink-900">#{result.queuePosition}</strong>, at the
              end of the rotation.
            </p>
          )}
        </Card>

        <Button className="mt-5" onClick={onDone}>
          Back to the register
        </Button>
      </div>
    );
  }

  // --- confirmation step (REQ-41) -----------------------------------------
  if (preview) {
    const hasCatchUp = !isZeroAmount(preview.catchUp.amount);
    return (
      <div className="max-w-lg">
        <PageHeader
          title="Confirm the registration"
          description={`Read this to ${form.fullName.split(" ")[0] || "them"} before confirming. Nothing has been saved yet.`}
        />

        <Card className="p-5 space-y-4">
          <div>
            <p className="text-[13px] font-medium text-ink-500">Member</p>
            <p className="text-[15px] text-ink-900">{form.fullName}</p>
            <p className="text-[13px] text-ink-500 font-mono tnum">{fmtPhone(form.phone)}</p>
          </div>

          {preview.existingAccount && (
            <Alert tone="info">
              This person already has an account from another club. It will be reused, so they keep
              one password across both clubs.
            </Alert>
          )}

          <div className="flex gap-6">
            <div>
              <p className="text-[13px] font-medium text-ink-500">Role</p>
              <p className="text-[15px] text-ink-900">{preview.role}</p>
            </div>
            {preview.queuePosition != null && (
              <div>
                <p className="text-[13px] font-medium text-ink-500">Queue position</p>
                <p className="text-[15px] font-mono tnum text-ink-900">#{preview.queuePosition}</p>
              </div>
            )}
          </div>

          {hasCatchUp ? (
            <Alert tone="attention" title={`Catch-up obligation: ${money(preview.catchUp.amount)}`}>
              {preview.catchUp.explanation}
            </Alert>
          ) : (
            <Alert tone="positive">
              No catch-up obligation. They join at the start of a cycle.
            </Alert>
          )}
        </Card>

        {error && (
          <Alert tone="exception" icon={AlertCircle} className="mt-4">
            {error}
          </Alert>
        )}

        <div className="mt-5 flex gap-3">
          <Button onClick={confirm} loading={busy}>
            Confirm registration
          </Button>
          <Button variant="secondary" onClick={() => setPreview(null)} disabled={busy}>
            <ArrowLeft size={15} aria-hidden />
            Change details
          </Button>
        </div>
      </div>
    );
  }

  // --- the form ------------------------------------------------------------
  return (
    <div className="max-w-lg">
      <PageHeader
        title="Register a member"
        description="A club decides who joins it, so there is no public sign-up. You are recording somebody the club has already accepted."
      />

      <Card className="p-5 space-y-5">
        <Field label="Full name" htmlFor="fullName" required error={fields.fullName}>
          <Input id="fullName" value={form.fullName} onChange={set("fullName")} invalid={!!fields.fullName} />
        </Field>

        <Field
          label="Identity number"
          htmlFor="idNumber"
          required
          error={fields.idNumber}
          hint="Thirteen digits. A passport or permit number is also accepted."
        >
          <Input
            id="idNumber"
            inputMode="numeric"
            className="font-mono tnum"
            value={form.idNumber}
            onChange={set("idNumber")}
            invalid={!!fields.idNumber}
          />
        </Field>

        <Field label="Phone number" htmlFor="phone" required error={fields.phone}>
          <Input
            id="phone"
            type="tel"
            inputMode="tel"
            placeholder="082 441 7788"
            value={form.phone}
            onChange={set("phone")}
            invalid={!!fields.phone}
          />
        </Field>

        <div className="pt-1">
          <p className="text-[13px] font-medium text-ink-700">
            Email or postal address
            <span className="text-exc-600 ml-0.5" aria-hidden>*</span>
          </p>
          <p className="text-[12px] text-ink-500 mt-0.5 mb-2.5">
            One of the two is required. Many members have a postal address and no email.
          </p>
          <div className="space-y-3">
            <Input
              aria-label="Email address"
              type="email"
              placeholder="Email address"
              value={form.email}
              onChange={set("email")}
              invalid={!!fields.email}
            />
            <Input
              aria-label="Postal address"
              placeholder="Postal address"
              value={form.postalAddress}
              onChange={set("postalAddress")}
            />
          </div>
          {fields.email && <p className="text-[12px] text-exc-600 mt-1.5">{fields.email}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <Field label="Role" htmlFor="role">
            <Select id="role" value={form.role} onChange={set("role")}>
              {ROLES.map((r) => (
                <option key={r} value={r}>{r}</option>
              ))}
            </Select>
          </Field>
          <Field label="Join date" htmlFor="joinDate">
            <Input id="joinDate" type="date" value={form.joinDate} onChange={set("joinDate")} />
          </Field>
        </div>

        <div className="pt-2 border-t border-line">
          <p className="text-[13px] font-medium text-ink-700 mt-3">
            Next of kin
            <span className="text-exc-600 ml-0.5" aria-hidden>*</span>
          </p>
          <p className="text-[12px] text-ink-500 mt-0.5 mb-2.5">
            Who the club should contact about this member.
          </p>
          <div className="grid sm:grid-cols-3 gap-3">
            <Input aria-label="Next of kin name" placeholder="Name" value={form.nextOfKin.name} onChange={setKin("name")} />
            <Input aria-label="Relationship" placeholder="Relationship" value={form.nextOfKin.relationship} onChange={setKin("relationship")} />
            <Input aria-label="Next of kin phone" type="tel" placeholder="Phone" value={form.nextOfKin.phone} onChange={setKin("phone")} />
          </div>
          {fields.nextOfKin && <p className="text-[12px] text-exc-600 mt-1.5">{fields.nextOfKin}</p>}
        </div>
      </Card>

      {error && (
        <Alert tone="exception" icon={AlertCircle} className="mt-4">
          {error}
        </Alert>
      )}

      <div className="mt-5 flex gap-3">
        <Button onClick={check} loading={busy}>
          Check details
        </Button>
        <Button variant="secondary" onClick={onCancel} disabled={busy}>
          Cancel
        </Button>
      </div>
    </div>
  );
}