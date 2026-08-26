"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search, UserPlus, Users, ArrowRight, Info } from "lucide-react";
import { useSession, useData, useQuery } from "@/lib/data";
import { money, maskId, fmtDate, initials, cx } from "@/lib/format";
import { Card } from "@/components/ui/Card";
import { Table, THead, TH, TR, TD } from "@/components/ui/Table";
import { Alert, EmptyState, SkeletonRows } from "@/components/ui/States";
import { Input, Select, Field } from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Dialog from "@/components/ui/Dialog";
import Money from "@/components/patterns/Money";
import StatusBadge from "@/components/patterns/StatusBadge";
import PageHeader from "@/components/patterns/PageHeader";
import { useToast } from "@/components/ui/Toast";

const FILTERS = ["All", "Good standing", "In arrears", "Exited"];

export default function MembersPage() {
  const { club, role, dispatch } = useSession();
  const d = useData();
  const toast = useToast();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("All");
  const [registering, setRegistering] = useState(false);

  const { data, loading } = useQuery(() => {
    if (!club) return null;
    const list = d.membersFor(club.id).map((m) => ({ ...m, balance: d.memberBalance(club.id, m.id) }));
    return { list, constitution: d.constitutionFor(club.id) };
  }, [club?.id]);

  const filtered = useMemo(() => {
    if (!data) return [];
    return data.list
      .filter((m) => (filter === "All" ? m.standing !== "Exited" : m.standing === filter))
      .filter((m) => m.fullName.toLowerCase().includes(query.toLowerCase()))
      .sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [data, filter, query]);

  if (!club) return null;
  // REQ-43: only the Secretary or the Chairperson may register a member.
  const canRegister = role === "Secretary" || role === "Chairperson";
  const canRevealId = role === "Secretary";

  return (
    <>
      <PageHeader
        title="Members"
        description={`Everyone in ${club.shortName}, what they have paid and where they stand. Records of members who have left are kept, never deleted.`}
        meta={
          <>
            <Badge tone="neutral">{data?.list.filter((m) => m.standing !== "Exited").length ?? 0} active</Badge>
            {data?.list.some((m) => m.standing === "In arrears") && (
              <Badge tone="attention">{data.list.filter((m) => m.standing === "In arrears").length} in arrears</Badge>
            )}
          </>
        }
        actions={canRegister && <Button onClick={() => setRegistering(true)}><UserPlus size={15} /> Register a member</Button>}
      />

      {!canRegister && (
        <Alert tone="neutral" icon={Info} className="mb-5">
          Registering and amending member records is the secretary's or chairperson's work. You can see the register.
        </Alert>
      )}

      <Card>
        <div className="p-4 border-b border-line flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1 min-w-0">
            <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-400" aria-hidden />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a member by name"
              aria-label="Search members" className="pl-9" />
          </div>
          <div className="flex gap-1 overflow-x-auto no-scrollbar">
            {FILTERS.map((f) => (
              <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
                className={cx("px-3 h-9 rounded text-[13px] font-medium whitespace-nowrap border transition-colors",
                  filter === f ? "bg-navy-950 text-white border-navy-950" : "bg-surface text-ink-700 border-line-strong hover:bg-canvas")}>
                {f}
              </button>
            ))}
          </div>
        </div>

        {loading ? <SkeletonRows rows={8} cols={5} /> : filtered.length === 0 ? (
          <EmptyState icon={Users} title={query ? `Nobody matches “${query}”` : `No members are ${filter.toLowerCase()}`}
            description={query ? "Check the spelling, or clear the search." : "Try another filter."} />
        ) : (
          <>
            <div className="hidden md:block">
              <Table>
                <THead>
                  <TR>
                    <TH>Member</TH><TH>Role</TH><TH>Standing</TH>
                    <TH align="right">Paid in</TH><TH align="right">Outstanding</TH><TH>Joined</TH><TH></TH>
                  </TR>
                </THead>
                <tbody>
                  {filtered.map((m) => (
                    <TR key={m.id} className="hover:bg-canvas/60">
                      <TD>
                        <Link href={`/members/${m.id}`} className="flex items-center gap-3 group">
                          <span className="w-8 h-8 rounded-full bg-canvas border border-line grid place-items-center text-[11px] font-semibold text-ink-700 shrink-0">
                            {initials(m.fullName)}
                          </span>
                          <span className="min-w-0">
                            <span className="block text-[14px] font-medium text-ink-900 group-hover:text-accent-600 transition-colors">{m.fullName}</span>
                            <span className="block text-[12px] text-ink-400 tnum">{maskId(m.idNumber, canRevealId)}</span>
                          </span>
                        </Link>
                      </TD>
                      <TD>{m.role !== "Member" ? <Badge tone="accent">{m.role}</Badge> : <span className="text-[13px] text-ink-500">Member</span>}</TD>
                      <TD><StatusBadge status={m.standing} /></TD>
                      <TD align="right"><Money value={m.balance.paid} size="sm" /></TD>
                      <TD align="right">
                        {m.balance.outstanding > 0 ? <Money value={m.balance.outstanding} size="sm" tone="exception" /> : <span className="text-ink-400">—</span>}
                      </TD>
                      <TD className="text-[13px] tnum whitespace-nowrap">{fmtDate(m.joinDate)}</TD>
                      <TD align="right">
                        <Link href={`/members/${m.id}`} aria-label={`Open ${m.fullName}`} className="text-ink-400 hover:text-accent-600 transition-colors inline-block">
                          <ArrowRight size={15} />
                        </Link>
                      </TD>
                    </TR>
                  ))}
                </tbody>
              </Table>
            </div>

            <ul className="md:hidden divide-y divide-line">
              {filtered.map((m) => (
                <li key={m.id}>
                  <Link href={`/members/${m.id}`} className="flex items-center gap-3 px-4 py-3.5 hover:bg-canvas/60 transition-colors">
                    <span className="w-9 h-9 rounded-full bg-canvas border border-line grid place-items-center text-[12px] font-semibold text-ink-700 shrink-0">
                      {initials(m.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="text-[14px] font-medium text-ink-900 truncate">{m.fullName}</span>
                        {m.role !== "Member" && <Badge tone="accent">{m.role}</Badge>}
                      </span>
                      <span className="block text-[12px] text-ink-500 mt-0.5 tnum">
                        Paid {money(m.balance.paid)}
                        {m.balance.outstanding > 0 && <span className="text-exc-600"> · {money(m.balance.outstanding)} owing</span>}
                      </span>
                    </span>
                    <StatusBadge status={m.standing} />
                  </Link>
                </li>
              ))}
            </ul>
          </>
        )}
      </Card>

      {registering && data && (
        <RegisterDialog
          club={club} constitution={data.constitution}
          onClose={() => setRegistering(false)}
          onSave={(member) => {
            dispatch({ type: "REGISTER_MEMBER", payload: { ...member, clubId: club.id, usesQueue: club.type === "Rotating" } });
            setRegistering(false);
            toast.push({
              tone: "success", title: `${member.fullName} registered`,
              description: club.type === "Rotating"
                ? "Placed at the end of the payout queue, as the constitution requires."
                : "Added to the register."
            });
          }}
        />
      )}
    </>
  );
}

function RegisterDialog({ club, constitution, onClose, onSave }) {
  const [form, setForm] = useState({ fullName: "", idNumber: "", phone: "", email: "", role: "Member", nokName: "", nokRel: "Spouse", nokPhone: "" });
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const set = (k) => (e) => { setForm((f) => ({ ...f, [k]: e.target.value })); setErrors((x) => ({ ...x, [k]: null })); };

  // A mid-cycle joiner owes a catch-up. The SRS requires this (REQ-41) but leaves
  // the formula to the constitution, which has no catch-up parameter — a genuine
  // gap. The prototype assumes one cycle's contribution and says so.
  const catchUp = constitution.contributionAmount;

  function validate() {
    const e = {};
    if (form.fullName.trim().length < 3) e.fullName = "Enter the member's full name.";
    if (!/^\d{13}$/.test(form.idNumber.trim())) e.idNumber = "A South African identity number is thirteen digits.";
    if (form.phone.trim().length < 9) e.phone = "A contact number is required (REQ-34).";
    if (!form.email.trim() && !form.phone.trim()) e.email = "At least one way of reaching them is required.";
    if (form.nokName.trim().length < 3) e.nokName = "Next of kin is required (REQ-35).";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  return (
    <Dialog
      open onClose={onClose} size="lg"
      title="Register a member"
      description={`They will join ${club.name} from today.`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>Cancel</Button>
          <Button loading={busy} onClick={() => {
            if (!validate()) return;
            setBusy(true);
            setTimeout(() => onSave({
              fullName: form.fullName.trim(), idNumber: form.idNumber.trim(), phone: form.phone.trim(),
              email: form.email.trim(), role: form.role, userId: `u-new-${Date.now()}`,
              joinDate: new Date().toISOString(), catchUp,
              nextOfKin: { name: form.nokName.trim(), relationship: form.nokRel, phone: form.nokPhone.trim() }
            }), 380);
          }}>Register</Button>
        </>
      }
    >
      <div className="space-y-5">
        <section className="space-y-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">The member</p>
          <div className="grid sm:grid-cols-2 gap-4">
            <Field label="Full name" htmlFor="fn" required error={errors.fullName} className="sm:col-span-2">
              <Input id="fn" value={form.fullName} onChange={set("fullName")} data-autofocus invalid={!!errors.fullName} placeholder="Tshepo Ramaphakela" />
            </Field>
            <Field label="Identity number" htmlFor="idn" required error={errors.idNumber}
              hint="Shown masked to everyone except the member and the secretary.">
              <Input id="idn" value={form.idNumber} onChange={set("idNumber")} inputMode="numeric" maxLength={13}
                className="tnum" invalid={!!errors.idNumber} placeholder="9202180644085" />
            </Field>
            <Field label="Contact number" htmlFor="ph" required error={errors.phone}>
              <Input id="ph" value={form.phone} onChange={set("phone")} inputMode="tel" invalid={!!errors.phone} placeholder="082 441 7788" />
            </Field>
            <Field label="Email address" htmlFor="em" hint="Optional if a phone number is given" error={errors.email}>
              <Input id="em" type="email" value={form.email} onChange={set("email")} invalid={!!errors.email} />
            </Field>
            <Field label="Role in the club" htmlFor="rl">
              <Select id="rl" value={form.role} onChange={set("role")}>
                <option>Member</option><option>Treasurer</option><option>Chairperson</option><option>Secretary</option>
              </Select>
            </Field>
          </div>
        </section>

        <section className="space-y-4">
          <p className="text-[12px] font-semibold uppercase tracking-wide text-ink-400">Next of kin</p>
          <div className="grid sm:grid-cols-3 gap-4">
            <Field label="Name" htmlFor="nk" required error={errors.nokName}>
              <Input id="nk" value={form.nokName} onChange={set("nokName")} invalid={!!errors.nokName} />
            </Field>
            <Field label="Relationship" htmlFor="nr">
              <Select id="nr" value={form.nokRel} onChange={set("nokRel")}>
                {["Spouse", "Child", "Parent", "Sibling", "Other"].map((r) => <option key={r}>{r}</option>)}
              </Select>
            </Field>
            <Field label="Contact number" htmlFor="np">
              <Input id="np" value={form.nokPhone} onChange={set("nokPhone")} inputMode="tel" />
            </Field>
          </div>
        </section>

        <Alert tone="info" icon={Info} title="Joining part-way through a cycle">
          They owe a catch-up of {money(catchUp)} before their first full cycle, and they take the last place in
          the payout queue.
          <span className="block mt-1.5 opacity-80">
            The SRS requires a catch-up obligation but the constitution has no parameter defining how it is
            calculated. One cycle's contribution is assumed here; this is one of the gaps to settle with the client.
          </span>
        </Alert>
      </div>
    </Dialog>
  );
}
