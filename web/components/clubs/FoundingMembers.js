"use client";
import PersonFields, { emptyPerson } from "./PersonFields";
import { Field, Select } from "@/components/ui/Input";
import Button from "@/components/ui/Button";
const ROLES = ['Chairperson','Treasurer','Secretary','Member'];
export default function FoundingMembers({ form, setForm, applicant }) {
  function changeRole(role) {
    const remaining = ROLES.filter(r => r !== role);
    setForm(f => ({...f, applicantRole:role, foundingMembers:remaining.map(r => f.foundingMembers.find(p => p.role === r) || {...emptyPerson(),role:r})}));
  }
  return <section className="border-t border-line pt-5 space-y-5">
    <h2 className="text-lg font-semibold">Founding membership</h2>
    <p className="text-sm text-ink-600">All three officer roles and at least one ordinary member are required. Each position must be held by a different person. Existing accounts keep their passwords.</p>
    <Field label={`Your role — ${applicant?.fullName || 'you'}`} htmlFor="applicant-role" required>
      <Select id="applicant-role" value={form.applicantRole} onChange={e => changeRole(e.target.value)}>{ROLES.map(r => <option key={r}>{r}</option>)}</Select>
    </Field>
    {form.foundingMembers.map((person,i) => <fieldset key={i} className="border border-line rounded p-4 space-y-4">
      <legend className="px-2 font-semibold">{person.role === 'Member' ? 'Ordinary member' : person.role}</legend>
      <PersonFields value={person} prefix={`founder-${i}`} onChange={value => setForm(f => ({...f,foundingMembers:f.foundingMembers.map((p,j) => j === i ? value : p)}))} />
      {i >= 3 && <Button variant="ghost" onClick={() => setForm(f => ({...f,foundingMembers:f.foundingMembers.filter((_,j) => j !== i)}))}>Remove member</Button>}
    </fieldset>)}
    <Button variant="secondary" onClick={() => setForm(f => ({...f,foundingMembers:[...f.foundingMembers,{...emptyPerson(),role:'Member'}]}))}>Add another ordinary member</Button>
  </section>;
}
