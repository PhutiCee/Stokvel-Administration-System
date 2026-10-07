"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle } from "lucide-react";
import Button from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Alert } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { auth, ApiError } from "@/lib/api";

// Sign in or start a new club registration.
export default function LoginPage() {
  const router = useRouter();
  const { refresh } = useSession();

  const [identifier, setIdentifier] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function onSubmit(e) {
    e.preventDefault();
    if (busy) return;

    if (!identifier.trim() || !password) {
      setError("Enter your phone number and your password.");
      return;
    }

    setBusy(true);
    setError(null);

    try {
      const result = await auth.login(identifier.trim(), password);
      await refresh();
      router.push(result.next || "/select-club");
    } catch (err) {
      setError(
        err instanceof ApiError
          ? err.message
          : "Cannot reach the system. Check your connection and try again."
      );
      setPassword("");
      setBusy(false);
    }
  }

  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-5 py-12">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <h1 className="text-[30px] font-semibold tracking-tight">Stokvel Ledger</h1>
          <p className="text-[15px] text-ink-500 mt-2">Sign in to your savings club.</p>
        </div>
        <div className="bg-white border rounded p-6 sm:p-8">
            <form onSubmit={onSubmit} className="space-y-5" noValidate>
              <Field
                label="Phone number"
                htmlFor="identifier"
                required
                hint="The number your club registered you with."
              >
                <Input
                  id="identifier"
                  name="identifier"
                  type="tel"
                  inputMode="tel"
                  autoComplete="username"
                  autoFocus
                  placeholder="082 441 7788"
                  value={identifier}
                  onChange={(e) => {
                    setIdentifier(e.target.value);
                    setError(null);
                  }}
                  invalid={!!error}
                />
              </Field>

              <Field label="Password" htmlFor="password" required>
                <Input
                  id="password"
                  name="password"
                  type="password"
                  autoComplete="current-password"
                  placeholder="Your password"
                  value={password}
                  onChange={(e) => {
                    setPassword(e.target.value);
                    setError(null);
                  }}
                  invalid={!!error}
                />
              </Field>

              <p className="-mt-3 text-right text-sm">
                <Link href="/forgot-password" className="text-accent-700 underline">Forgot password?</Link>
              </p>

              {error && (
                <Alert tone="exception" icon={AlertCircle}>
                  {error}
                </Alert>
              )}

              <Button type="submit" size="lg" className="w-full" loading={busy}>
                {busy ? "Signing in" : "Sign in"}
              </Button>
            </form>

        </div>
        <p className="mt-6 text-center"><Link href="/create-club" className="text-accent-700 underline">Register a club</Link></p>
        <p className="mt-6 text-center text-[14px] text-ink-500">
          Trouble signing in? Ask your club’s secretary.
        </p>
      </div>
    </main>
  );
}
