"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight, BookLock, LogOut, Building2 } from "lucide-react";
import { useSession, useData } from "@/lib/data";
import { money, fmtDate, initials } from "@/lib/format";
import Badge from "@/components/ui/Badge";
import StatusBadge from "@/components/patterns/StatusBadge";
import Button from "@/components/ui/Button";

/**
 * REQ-16: after authentication, a user belonging to more than one club is shown a
 * selector displaying, for each club, their role and their outstanding contribution
 * position. That last part matters — it lets someone decide which club needs them
 * before they commit to a context.
 */
export default function SelectClubPage() {
  const router = useRouter();
  const { user, memberships, selectClub, signOut } = useSession();
  const data = useData();

  useEffect(() => { if (!user) router.replace("/login"); }, [user, router]);
  useEffect(() => {
    if (user?.isPlatformAdmin) router.replace("/platform");
    else if (user && memberships.length === 1) {
      selectClub(memberships[0].clubId);
      router.replace("/dashboard");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, memberships.length]);

  if (!user) return null;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-navy-950 text-white">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between on-navy">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-md bg-accent-600 grid place-items-center"><BookLock size={15} aria-hidden /></span>
            <span className="text-[13px] font-semibold">Stokvel Administration System</span>
          </div>
          <button onClick={() => { signOut(); router.push("/login"); }} className="flex items-center gap-1.5 text-[13px] text-white/60 hover:text-white transition-colors">
            <LogOut size={14} aria-hidden /> Sign out
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-5 sm:px-8 py-10 sm:py-14">
        <p className="text-[13px] text-ink-500">Signed in as {user.fullName}</p>
        <h1 className="text-2xl font-semibold mt-1 tracking-[-0.01em]">Which club are you working in?</h1>
        <p className="text-sm text-ink-500 mt-2 max-w-xl leading-relaxed">
          You hold a different role in each. Everything you see afterwards belongs to the club you choose here,
          and nothing from the others is reachable from inside it.
        </p>

        <ul className="mt-8 space-y-3">
          {memberships.map((m) => {
            const club = data.state.clubs.find((c) => c.id === m.clubId);
            if (!club) return null;
            const bal = data.memberBalance(club.id, m.id);
            const pool = data.poolBalance(club.id);
            return (
              <li key={m.id}>
                <button
                  onClick={() => { selectClub(club.id); router.push("/dashboard"); }}
                  className="w-full text-left bg-surface border border-line rounded-lg shadow-card hover:shadow-pop hover:border-line-strong transition-all p-4 sm:p-5 group"
                >
                  <div className="flex items-start gap-4">
                    <span className="w-11 h-11 rounded-lg bg-navy-950 text-white grid place-items-center text-[13px] font-bold shrink-0">
                      {initials(club.shortName)}
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="text-[15px] font-semibold text-ink-900">{club.name}</h2>
                        <Badge tone="accent">{m.role}</Badge>
                      </div>
                      <p className="text-[13px] text-ink-500 mt-0.5">
                        {club.type} · {club.town} · member since {fmtDate(m.joinDate)}
                      </p>

                      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-2 mt-4">
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-ink-400">Your position</dt>
                          <dd className="text-sm tnum font-medium mt-0.5">
                            {bal.outstanding > 0
                              ? <span className="text-warn-700">{money(bal.outstanding)} outstanding</span>
                              : <span className="text-pos-700">Up to date</span>}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[11px] uppercase tracking-wide text-ink-400">Standing</dt>
                          <dd className="mt-0.5"><StatusBadge status={m.standing} /></dd>
                        </div>
                        <div className="hidden sm:block">
                          <dt className="text-[11px] uppercase tracking-wide text-ink-400">Club pool</dt>
                          <dd className="text-sm tnum font-medium mt-0.5 text-ink-900">{money(pool)}</dd>
                        </div>
                      </dl>
                    </div>
                    <ArrowRight size={16} className="text-ink-400 group-hover:text-accent-600 group-hover:translate-x-0.5 transition-all shrink-0 mt-1" aria-hidden />
                  </div>
                </button>
              </li>
            );
          })}
        </ul>

        {memberships.length === 0 && (
          <div className="mt-8 bg-surface border border-line rounded-lg p-8 text-center">
            <Building2 size={20} className="mx-auto text-ink-400 mb-3" aria-hidden />
            <p className="text-sm font-semibold">You are not a member of any club yet</p>
            <p className="text-[13px] text-ink-500 mt-1.5 max-w-sm mx-auto leading-relaxed">
              Members are added by their club's secretary or chairperson. Ask an officer of your stokvel to
              register you, and the club will appear here.
            </p>
            <Button variant="secondary" size="sm" className="mt-4" onClick={() => { signOut(); router.push("/login"); }}>
              Sign in as someone else
            </Button>
          </div>
        )}
      </main>
    </div>
  );
}
