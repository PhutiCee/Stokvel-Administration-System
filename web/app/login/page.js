"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Lock } from "lucide-react";
import Wordmark from "@/components/Wordmark";
import Button from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Alert } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { auth, ApiError } from "@/lib/api";

/**
 * Sign in. Use Case 1, REQ-1.
 *
 * Three decisions worth knowing about.
 *
 * 1. THE PHONE NUMBER IS THE USERNAME. Members of a burial society in Seshego
 *    have a phone; many do not have an email address they can recall under
 *    pressure. The server normalises spacing and the +27 prefix, so 082 441
 *    7788, 0824417788 and +27 82 441 7788 all reach the same account.
 *
 * 2. THERE IS NO "CREATE AN ACCOUNT" LINK, and its absence is explained rather
 *    than left as a puzzle. REQ-43 reserves registration to the secretary or
 *    chairperson: a stokvel decides who joins it, not the software.
 *
 * 3. ONE MESSAGE FOR EVERY FAILURE. The server returns the same sentence
 *    whether the number is unknown or the password is wrong (REQ-1), and this
 *    screen shows whatever the server said rather than composing its own —
 *    otherwise the careful work on the server is undone by the interface.
 */
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
    <div className="min-h-screen lg:grid lg:grid-cols-[1fr_minmax(0,460px)]">
      {/* Sign-in */}
      <div className="flex flex-col min-h-screen lg:min-h-0 px-5 sm:px-10 py-7">
        <Wordmark href="/" />

        <div className="flex-1 flex items-center">
          <div className="w-full max-w-sm mx-auto py-12">
            <h1 className="text-[26px] font-semibold tracking-[-0.01em]">Sign in</h1>
            <p className="text-[14px] text-ink-500 mt-2 leading-relaxed">
              You will choose your club after you sign in. Nothing about any club is shown before
              then.
            </p>

            <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
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

              {error && (
                <Alert tone="exception" icon={AlertCircle}>
                  {error}
                </Alert>
              )}

              <Button type="submit" size="lg" className="w-full" loading={busy}>
                {busy ? "Signing in" : "Sign in"}
              </Button>
            </form>

            <p className="mt-6 text-[13px] text-ink-500 leading-relaxed flex items-start gap-2">
              <Lock size={13} className="shrink-0 mt-[3px] text-ink-400" aria-hidden />
              <span>
                Trouble signing in? Ask your club&rsquo;s secretary. They keep the register and can
                reset your details — there is no public sign-up, which is why this page has no link
                to create an account.
              </span>
            </p>
          </div>
        </div>
      </div>

      {/* Reassurance panel. Quiet on purpose: this is not the place to sell
          anything, it is the place to tell a member their money is recorded
          properly before they hand over a password. */}
      <aside className="bg-navy-950 text-white on-navy px-5 sm:px-10 py-12 lg:py-0 lg:flex lg:items-center">
        <div className="w-full max-w-sm mx-auto">
          <p className="text-[17px] leading-relaxed font-medium">
            Every contribution, penalty and payout in your club, in one book that cannot be quietly
            edited.
          </p>

          <ul className="mt-8 space-y-5 text-[14px] leading-relaxed text-white/60">
            <li className="border-l-2 border-white/20 pl-4">
              A mistake is corrected by a reversing entry. Nothing is ever deleted, by anyone.
            </li>
            <li className="border-l-2 border-white/20 pl-4">
              A payout is initiated by one officer and approved by another. Never by the same
              person.
            </li>
            <li className="border-l-2 border-white/20 pl-4">
              You can open your own statement at any time, without asking anybody for the book.
            </li>
          </ul>
        </div>
      </aside>
    </div>
  );
}