"use client";
import { useState } from "react";
import { auth } from "@/lib/api";
import { useSession } from "@/lib/session";
import { Alert, Card } from "@/components/ui/States";
import { Field, Input } from "@/components/ui/Input";
import Button from "@/components/ui/Button";
import PersonFields, { emptyPerson } from "./PersonFields";
export default function RegistrationAccess() {
  const { refresh } = useSession();
  const [mode,setMode] = useState('new'), [person,setPerson] = useState(emptyPerson), [password,setPassword] = useState('');
  const [error,setError] = useState(null), [fields,setFields] = useState({}), [busy,setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault(); if (busy) return; setBusy(true); setError(null); setFields({});
    try {
      if (mode === 'new') { await auth.register({...person,password}); setMode('existing'); }
      await auth.login(person.phone,password); await refresh();
    } catch(e) { setError(e.message); setFields(e.detail?.fields || {}); }
    finally { setBusy(false); }
  }
  return <Card className="p-5 sm:p-7 space-y-5">
    <h2 className="text-xl font-semibold">Start with your account</h2>
    <p>Your account lets you submit a club and return to check its approval. You do not need to belong to an existing club.</p>
    <div className="flex flex-wrap gap-3">
      <Button variant={mode === 'new' ? 'primary' : 'secondary'} onClick={() => {setMode('new');setError(null);}}>I’m new here</Button>
      <Button variant={mode === 'existing' ? 'primary' : 'secondary'} onClick={() => {setMode('existing');setError(null);}}>I already have an account</Button>
    </div>
    <form onSubmit={submit} className="space-y-5">
      {mode === 'new' ? <PersonFields value={person} onChange={setPerson} prefix="account" fields={fields} kin={false} /> :
        <Field label="Phone number" htmlFor="existing-phone" required><Input id="existing-phone" type="tel" autoComplete="username" value={person.phone} onChange={e => setPerson({...person,phone:e.target.value})} /></Field>}
      <Field label="Password" htmlFor="account-password" required error={fields.password} hint={mode === 'new' ? 'Use 10–128 characters.' : undefined}>
        <Input id="account-password" type="password" autoComplete={mode === 'new' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} />
      </Field>
      {error && <Alert tone="exception">{error}</Alert>}
      <Button type="submit" loading={busy}>{mode === 'new' ? 'Create account and continue' : 'Sign in and continue'}</Button>
    </form>
  </Card>;
}
