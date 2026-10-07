"use client";
import Link from "next/link";
import { useState } from "react";
import { Alert, Card } from "@/components/ui/States";
import Button from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { auth } from "@/lib/api";

export default function ForgotPasswordPage() {
  const [identifier, setIdentifier] = useState("");
  const [message, setMessage] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    setBusy(true); setMessage(null); setError(null);
    try {
      const result = await auth.requestPasswordReset(identifier.trim());
      setMessage(result.message);
    } catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen flex items-center justify-center px-5 py-12">
    <Card className="w-full max-w-md p-6 sm:p-8 space-y-5">
      <Link href="/login" className="text-sm text-accent-700 underline">Back to sign in</Link>
      <div><h1 className="text-2xl font-semibold">Reset your password</h1>
        <p className="mt-2 text-sm text-ink-600">Enter the phone number you use to sign in. We’ll send a reset link to the email address registered to that account.</p>
      </div>
      <form onSubmit={submit} className="space-y-5">
        <Field label="Phone number" htmlFor="identifier" required hint="If your account has no registered email, contact your club secretary.">
          <Input id="identifier" type="tel" required maxLength={32} autoComplete="username" value={identifier} onChange={e => setIdentifier(e.target.value)} />
        </Field>
        {message && <Alert>{message}</Alert>}
        {error && <Alert tone="exception">{error}</Alert>}
        <Button type="submit" loading={busy}>Send reset link</Button>
      </form>
    </Card>
  </main>;
}
