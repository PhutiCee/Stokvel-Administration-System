"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Alert, Card } from "@/components/ui/States";
import Button from "@/components/ui/Button";
import { Field, Input } from "@/components/ui/Input";
import { auth } from "@/lib/api";

export default function ResetPasswordPage() {
  const [token, setToken] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState(null);
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(false);
  const tokenRead = useRef(false);
  useEffect(() => {
    // Strict Mode replays effects in development. Do not read the URL again
    // after removing its token, otherwise the second run clears the secret.
    if (tokenRead.current) return;
    tokenRead.current = true;
    const value = new URLSearchParams(window.location.search).get("token") || "";
    setToken(/^[a-f0-9]{64}$/.test(value) ? value : "");
    setReady(true);
    // Keep the one-use secret out of the address bar after the page reads it.
    window.history.replaceState(window.history.state, "", "/reset-password");
  }, []);
  async function submit(e) {
    e.preventDefault();
    if (busy) return;
    if (password !== confirm) { setError("The passwords do not match."); return; }
    setBusy(true); setError(null);
    try {
      await auth.resetPassword(token, password);
      setToken(""); setPassword(""); setConfirm(""); setDone(true);
    }
    catch (err) { setError(err.message); }
    finally { setBusy(false); }
  }
  return <main className="min-h-screen flex items-center justify-center px-5 py-12">
    <Card className="w-full max-w-md p-6 sm:p-8 space-y-5">
      <Link href="/login" className="text-sm text-accent-700 underline">Back to sign in</Link>
      <div><h1 className="text-2xl font-semibold">Choose a new password</h1>
        <p className="mt-2 text-sm text-ink-600">Use at least 10 characters. The reset link expires after 30 minutes and works once.</p>
      </div>
      {done ? <><Alert>Your password has been changed. Other active sessions have been signed out.</Alert><Button as={Link} href="/login">Sign in</Button></> :
        <form onSubmit={submit} className="space-y-5">
          {ready && !token && <Alert tone="exception">This reset link is missing or invalid. Reopen the link from your email or request a new one.</Alert>}
          <Field label="New password" htmlFor="password" required hint="10–128 characters.">
            <Input id="password" type="password" required autoComplete="new-password" minLength={10} maxLength={128} value={password} onChange={e => setPassword(e.target.value)} />
          </Field>
          <Field label="Confirm new password" htmlFor="confirm" required>
            <Input id="confirm" type="password" required autoComplete="new-password" minLength={10} maxLength={128} value={confirm} onChange={e => setConfirm(e.target.value)} />
          </Field>
          {error && <Alert tone="exception">{error}</Alert>}
          <Button type="submit" loading={busy} disabled={!token}>Change password</Button>
          <p><Link href="/forgot-password" className="text-sm text-accent-700 underline">Request a new reset link</Link></p>
        </form>}
    </Card>
  </main>;
}
