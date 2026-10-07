"use client";
import { Field, Input } from "@/components/ui/Input";
export const emptyPerson = () => ({ fullName:"", phone:"", idNumber:"", email:"", postalAddress:"", nextOfKin:{ name:"", relationship:"", phone:"" } });
export default function PersonFields({ value, onChange, prefix, fields = {}, kin = true }) {
  const set = key => e => onChange({ ...value, [key]:e.target.value });
  return <div className="grid sm:grid-cols-2 gap-4">
    {[["fullName","Full name","text"],["phone","Phone number","tel"],["idNumber","Identity / passport number","text"],["email","Email address","email"],["postalAddress","Postal address","text"]].map(([key,label,type]) =>
      <Field key={key} label={label} htmlFor={`${prefix}-${key}`} error={fields[key]} required={['fullName','phone','idNumber'].includes(key)} hint={key === 'postalAddress' ? 'An email or postal address is required.' : undefined}>
        <Input id={`${prefix}-${key}`} type={type} value={value[key] || ''} onChange={set(key)} />
      </Field>)}
    {kin && <fieldset className="sm:col-span-2 grid sm:grid-cols-3 gap-3"><legend className="text-sm font-medium mb-2">Next of kin</legend>
      {['name','relationship','phone'].map(key => <Field key={key} label={key[0].toUpperCase()+key.slice(1)} htmlFor={`${prefix}-kin-${key}`} required>
        <Input id={`${prefix}-kin-${key}`} type={key === 'phone' ? 'tel' : 'text'} value={value.nextOfKin?.[key] || ''} onChange={e => onChange({...value,nextOfKin:{...value.nextOfKin,[key]:e.target.value}})} />
      </Field>)}
    </fieldset>}
  </div>;
}
