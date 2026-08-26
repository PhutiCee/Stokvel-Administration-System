"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { BookLock, Lock, AlertCircle, ArrowRight } from "lucide-react";
import Button from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Alert } from "@/components/ui/States";
import PrototypeNote from "@/components/patterns/Prototype";
import { useSession, useData } from "@/lib/data";
import { initials } from "@/lib/format";

// Personas are offered because a demo cannot ask a reviewer to guess a password.
// REQ-43 restricts registration to the Secretary or Chairperson, so there is
// deliberately no "create account" route anywhere in the product.
const PERSONAS = [
  { id: "u-nomsa", label: "Treasurer of one club, ordinary member of another", detail: "Mmakau · Bokamoso" },
  { id: "u-thabo", label: "Chairperson, holds the approval authority", detail: "Mmakau · Lehumo" },
  { id: "u-refilwe", label: "Secretary, keeps the register and the minutes", detail: "Mmakau" },
  { id: "u-admin", label: "Platform Administrator, blind to club money", detail: "Platform level" }
];

export default function LoginPage() {
  const router = useRouter();
  const { signIn } = useSession();
  const { state } = useData();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  function enter(userId) {
    setBusy(true);
    setTimeout(() => {
      signIn(userId);
      const u = state.users.find((x) => x.id === userId);
      router.push(u?.isPlatformAdmin ? "/platform" : "/select-club");
    }, 420);
  }

  function onSubmit(e) {
    e.preventDefault();
    const match = state.users.find(
      (u) => u.email.toLowerCase() === username.trim().toLowerCase() || u.fullName.toLowerCase() === username.trim().toLowerCase()
    );
    // REQ-1: a message that does not disclose whether the username exists.
    if (!match || password.length < 4) {
      setError("Those details are not correct. Check your username and password and try again.");
      return;
    }
    setError(null);
    enter(match.id);
  }

  return (
    <div className="min-h-screen lg:grid lg:grid-cols-2">
      {/* Left: the sign-in itself */}
      <div className="flex flex-col min-h-screen lg:min-h-0 px-5 sm:px-10 py-8">
        <Link href="/" className="flex items-center gap-2.5 w-fit">
          <span className="w-7 h-7 rounded-md bg-accent-600 text-white grid place-items-center">
            <BookLock size={15} aria-hidden />
          </span>
          <span className="text-[14px] font-semibold tracking-tight text-ink-900">Stokvel Administration System</span>
        </Link>

        <div className="flex-1 flex items-center">
          <div className="w-full max-w-sm mx-auto py-10">
            <h1 className="text-2xl font-semibold tracking-[-0.01em]">Sign in</h1>
            <p className="text-sm text-ink-500 mt-1.5">
              Your club will be shown once you are in. You will not see any club information before that.
            </p>

            <form onSubmit={onSubmit} className="mt-7 space-y-4" noValidate>
              <Field label="Username or email address" htmlFor="username" required>
                <Input
                  id="username" name="username" autoComplete="username" value={username}
                  onChange={(e) => { setUsername(e.target.value); setError(null); }}
                  placeholder="nomsa.maluleke@gmail.com" invalid={!!error}
                  aria-invalid={!!error} aria-describedby={error ? "login-error" : undefined}
                />
              </Field>
              <Field label="Password" htmlFor="password" required>
                <Input
                  id="password" name="password" type="password" autoComplete="current-password"
                  value={password} onChange={(e) => { setPassword(e.target.value); setError(null); }}
                  placeholder="••••••••" invalid={!!error} aria-invalid={!!error}
                />
              </Field>

              {error && (
                <div id="login-error">
                  <Alert tone="exception" icon={AlertCircle}>{error}</Alert>
                </div>
              )}

              <Button type="submit" className="w-full" size="lg" loading={busy}>Sign in</Button>
            </form>

            <p className="mt-5 text-[12px] text-ink-500 leading-relaxed flex items-start gap-2">
              <Lock size={13} className="shrink-0 mt-0.5 text-ink-400" aria-hidden />
              Members are registered by their club's secretary or chairperson. There is no public sign-up,
              which is why this screen has no "create an account" link.
            </p>
          </div>
        </div>
      </div>

      {/* Right: persona entry, honestly labelled */}
      <div className="bg-navy-950 text-white px-5 sm:px-10 py-10 lg:py-0 lg:flex lg:items-center">
        <div className="w-full max-w-sm mx-auto">
          <h2 className="text-[15px] font-semibold">Enter as one of the seeded people</h2>
          <p className="text-[13px] text-white/55 mt-1.5 leading-relaxed">
            Nomsa is the one to start with. She is the treasurer of one club and an ordinary member of another,
            using the same account, which is the whole point of the tenancy model.
          </p>

          <ul className="mt-6 space-y-2">
            {PERSONAS.map((p) => {
              const u = state.users.find((x) => x.id === p.id);
              if (!u) return null;
              return (
                <li key={p.id}>
                  <button
                    onClick={() => enter(p.id)}
                    disabled={busy}
                    className="w-full text-left rounded-lg border border-white/10 bg-white/[0.04] hover:bg-white/[0.09] transition-colors px-3.5 py-3 flex items-center gap-3 group on-navy disabled:opacity-50"
                  >
                    <span className="w-9 h-9 rounded-full bg-accent-600 grid place-items-center text-[12px] font-semibold shrink-0">
                      {initials(u.fullName)}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block text-[13px] font-medium truncate">{u.fullName}</span>
                      <span className="block text-[12px] text-white/50 truncate">{p.label}</span>
                    </span>
                    <ArrowRight size={14} className="text-white/30 group-hover:text-white/70 transition-colors shrink-0" aria-hidden />
                  </button>
                </li>
              );
            })}
          </ul>

          <div className="mt-6">
            <PrototypeNote className="bg-white/[0.04] border-white/15">
              <span className="text-white/60">
                Authentication is simulated. No password is checked, hashed or stored, and no session token exists.
                Production adds real credentials, lockout after five failures, session expiry and federated sign-in.
              </span>
            </PrototypeNote>
          </div>
        </div>
      </div>
    </div>
  );
}
