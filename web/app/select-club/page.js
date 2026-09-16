"use client";

import Wordmark from "@/components/Wordmark";
import Button from "@/components/ui/Button";
import {
    Alert,
    Badge,
    Empty,
    Loading,
    StandingBadge,
} from "@/components/ui/States";
import { ApiError, auth } from "@/lib/api";
import { initials, isZeroAmount, money } from "@/lib/format";
import { useSession } from "@/lib/session";
import { AlertCircle, ChevronRight, Inbox, LogOut } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

/**
 * Choose a club. Use Case 1, REQ-15, REQ-16, REQ-17.
 *
 * This screen is the tenancy model made visible, and it is the single most
 * important thing to demonstrate: one person, one account, a DIFFERENT ROLE in
 * each club they belong to.
 *
 * Each club shows the role held there and what this person owes there, because
 * a list of names alone does not answer the question the member actually opened
 * the app to ask — which club needs me. A club where something is outstanding
 * says so, in the exception tone, before it is opened.
 */

const CLUB_TYPE_LABEL = {
  Rotating: "Rotating savings",
  Accumulating: "Accumulating",
  Burial: "Burial society",
};

export default function SelectClubPage() {
  const router = useRouter();
  const { user, status, refresh, signOut } = useSession();

  const [clubs, setClubs] = useState(null);
  const [error, setError] = useState(null);
  const [entering, setEntering] = useState(null);

  useEffect(() => {
    if (status === "signedOut") {
      router.replace("/login");
      return;
    }
    if (status !== "signedIn") return;

    let alive = true;
    auth
      .clubs()
      .then((data) => {
        if (alive) setClubs(data.clubs);
      })
      .catch((err) => {
        if (!alive) return;
        if (err instanceof ApiError && err.isUnauthorised) {
          router.replace("/login");
          return;
        }
        setError(err.message);
        setClubs([]);
      });

    return () => {
      alive = false;
    };
  }, [status, router]);

  async function enter(club) {
    if (entering) return;
    setEntering(club.clubId);
    setError(null);

    try {
      await auth.selectClub(club.clubId);
      await refresh();
      router.push("/dashboard");
    } catch (err) {
      setError(err.message);
      setEntering(null);
    }
  }

  async function handleSignOut() {
    await signOut();
    router.replace("/login");
  }

  if (status === "loading") {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loading label="Checking your session" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-surface">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Wordmark href={null} />
          <Button variant="ghost" size="sm" onClick={handleSignOut}>
            <LogOut size={14} aria-hidden />
            Sign out
          </Button>
        </div>
      </header>

      <main className="flex-1 max-w-3xl w-full mx-auto px-5 sm:px-8 py-12">
        <h1 className="text-[26px] font-semibold tracking-[-0.01em]">
          Good day{user?.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}
        </h1>
        <p className="mt-2 text-[14px] text-ink-500 leading-relaxed">
          {clubs === null
            ? "Fetching your clubs."
            : clubs.length === 1
              ? "You belong to one club."
              : `You belong to ${clubs.length} clubs. Choose which one to work in.`}
        </p>

        {error && (
          <Alert tone="exception" icon={AlertCircle} className="mt-6">
            {error}
          </Alert>
        )}

        {clubs === null ? (
          <Loading label="Loading your clubs" />
        ) : clubs.length === 0 ? (
          <div className="mt-8 bg-surface border border-line rounded-lg shadow-card">
            <Empty icon={Inbox} title="You do not belong to any club yet">
              A club&rsquo;s secretary or chairperson registers its members. Ask
              yours to add you, then sign in again.
            </Empty>
          </div>
        ) : (
          <ul className="mt-8 space-y-3">
            {clubs.map((club) => {
              const owes = !isZeroAmount(club.ownOutstanding);
              const suspended = club.status === "Suspended";
              const busy = entering === club.clubId;

              return (
                <li key={club.clubId}>
                  <button
                    onClick={() => enter(club)}
                    disabled={!!entering || suspended}
                    className="w-full text-left bg-surface border border-line rounded-lg shadow-card
                               px-5 py-4 flex items-center gap-4 group
                               hover:border-line-strong transition-colors
                               disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    <span
                      className="shrink-0 grid place-items-center w-11 h-11 rounded-full
                                 bg-navy-950 text-white text-[13px] font-semibold"
                      aria-hidden
                    >
                      {initials(club.shortName || club.name)}
                    </span>

                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
                        <span className="text-[15px] font-semibold text-ink-900 truncate">
                          {club.name}
                        </span>
                        <Badge
                          tone={club.role === "Member" ? "neutral" : "accent"}
                        >
                          {club.role}
                        </Badge>
                        {suspended && <Badge tone="exception">Suspended</Badge>}
                      </span>

                      <span className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[13px] text-ink-500">
                        <span>
                          {CLUB_TYPE_LABEL[club.clubType] || club.clubType}
                        </span>
                        <span aria-hidden>&middot;</span>
                        <span>{club.memberCount} members</span>
                        {club.town && (
                          <>
                            <span aria-hidden>&middot;</span>
                            <span className="truncate">{club.town}</span>
                          </>
                        )}
                      </span>

                      <span className="mt-2 flex flex-wrap items-center gap-2">
                        <StandingBadge standing={club.standing} />
                        {owes && (
                          <span className="text-[13px] font-medium text-exc-700 font-mono tnum">
                            {money(club.ownOutstanding)} outstanding
                          </span>
                        )}
                      </span>
                    </span>

                    <ChevronRight
                      size={18}
                      className={`shrink-0 transition-colors ${
                        busy
                          ? "text-accent-600"
                          : "text-ink-400 group-hover:text-ink-700"
                      }`}
                      aria-hidden
                    />
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-8 text-[13px] text-ink-500 leading-relaxed">
          Your role is held per club, so what you can do changes with the club
          you enter. Records are never shared between clubs.
        </p>
      </main>
    </div>
  );
}
