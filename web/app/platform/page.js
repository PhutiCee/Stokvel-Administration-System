"use client";
import ClubForm from "@/components/clubs/ClubForm";

/**
 * The Platform Administrator's screen. REQ-18, REQ-19, REQ-20, REQ-21.
 *
 * Deliberately austere, and deliberately thin on figures. This person
 * provisions clubs and suspends them; they do not see anybody's money. The
 * three aggregate numbers at the top are the ENTIRE financial picture available
 * here, and the club list beneath carries no financial column at all.
 *
 * The screen says so out loud, because a custodian who does not know the
 * boundary is one support request away from crossing it.
 */

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Building2,
  Users,
  Landmark,
  Plus,
  LogOut,
  Ban,
  RotateCcw,
  X,
  Check,
} from "lucide-react";
import Wordmark from "@/components/Wordmark";
import Button from "@/components/ui/Button";
import { Input, Select, Field, Textarea } from "@/components/ui/Input";
import { Card, Badge, Alert, Loading, Empty } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { platform as api, ApiError } from "@/lib/api";
import { money, fmtDate, cx } from "@/lib/format";

const CLUB_TYPES = ["Rotating", "Accumulating", "Burial"];
const FREQUENCIES = ["Weekly", "Fortnightly", "Monthly"];
const ORDER_METHODS = ["Random draw", "Seniority", "Negotiated"];

export default function PlatformPage() {
  const router = useRouter();
  const { status, user, isPlatformAdmin, signOut } = useSession();

  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [creating, setCreating] = useState(false);
  const [suspending, setSuspending] = useState(null);
  const [created, setCreated] = useState(null);
  const [reviewing, setReviewing] = useState(null);

  const load = useCallback(async (signal) => {
    try {
      setData(await api.overview({ signal }));
      setError(null);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(
        err instanceof ApiError ? err.message : "Could not load the platform.",
      );
    }
  }, []);

  useEffect(() => {
    if (status === "signedOut") {
      router.replace("/login");
      return;
    }
    if (status === "signedIn" && !isPlatformAdmin) {
      router.replace("/select-club");
      return;
    }
    if (status !== "signedIn") return;

    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [status, isPlatformAdmin, router, load]);

  async function reinstate(club) {
    setError(null);
    try {
      await api.reinstate(club.clubId);
      await load();
    } catch (err) {
      setError(err.message);
    }
  }

  if (status === "loading" || (!data && !error)) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loading label="Loading the platform" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex flex-col bg-canvas">
      <header className="bg-navy-950 text-white on-navy">
        <div className="max-w-5xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <Wordmark href={null} subdued />
            <Badge
              tone="neutral"
              className="bg-white/10 text-white/80 ring-white/20"
            >
              Platform
            </Badge>
          </div>
          <button
            onClick={async () => {
              await signOut();
              router.replace("/login");
            }}
            className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded text-[13px] text-white/70 hover:text-white hover:bg-white/10"
          >
            <LogOut size={13} aria-hidden />
            Sign out
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-5xl w-full mx-auto px-5 sm:px-8 py-8">
        <div className="flex flex-wrap items-start justify-between gap-4 mb-6">
          <div>
            <h1 className="text-[22px] font-semibold tracking-[-0.01em]">
              Good day{user?.fullName ? `, ${user.fullName.split(" ")[0]}` : ""}
            </h1>
            <p className="mt-1 text-[14px] text-ink-500 max-w-[62ch] leading-relaxed">
              You provision and suspend clubs. You do not have access to any
              club&rsquo;s members, contributions or ledger — the figures below
              are platform totals and are the only financial information this
              role can see.
            </p>
          </div>
          {!creating && (
            <Button
              onClick={() => {
                setCreating(true);
                setCreated(null);
              }}
            >
              <Plus size={15} aria-hidden />
              Provision a club
            </Button>
          )}
        </div>

        {reviewing && <ReviewClub club={reviewing} onClose={() => setReviewing(null)} onDone={async () => {
          setReviewing(null); await load();
        }} />}
        {error && (
          <Alert tone="exception" icon={AlertCircle} className="mb-5">
            {error}
          </Alert>
        )}

        {created && (
          <ProvisionedNotice
            result={created}
            onDismiss={() => setCreated(null)}
          />
        )}

        {creating ? (
          <ClubForm
            submitClub={api.createClub}
            onCancel={() => setCreating(false)}
            onDone={async (result) => {
              setCreating(false);
              setCreated(result);
              await load();
            }}
          />
        ) : data ? (
          <>
            <div className="grid sm:grid-cols-3 gap-4 mb-8">
              <Stat
                icon={Building2}
                label="Clubs"
                detail={
                  <ul>
                    {data.clubs.map((c) => (
                      <li key={c.clubId}>
                        {c.name}: {c.status}
                      </li>
                    ))}
                  </ul>
                }
                value={String(data.stats.clubCount)}
                note={
                  `${data.stats.activeClubs} active, ${data.clubs.filter(c => c.status === "Pending approval").length} waiting for approval, ${data.stats.suspendedClubs} suspended.`
                }
              />
              <Stat
                icon={Users}
                label="Current members"
                detail={
                  <ul>
                    {data.stats.memberBreakdown.map((r) => (
                      <li key={r.standing}>
                        {r.standing}: {r.count}
                      </li>
                    ))}
                  </ul>
                }
                value={String(data.stats.memberCount)}
                note={`Across ${data.stats.accountCount} accounts.`}
              />
              <Stat
                icon={Landmark}
                label="Funds under administration"
                detail={
                  <ul>
                    {data.stats.fundsBreakdown.map((r) => (
                      <li key={r.category}>
                        {r.category}: {money(r.amount)}
                      </li>
                    ))}
                  </ul>
                }
                value={money(data.stats.fundsUnderAdministration)}
                note="All clubs combined. Detail is aggregated by ledger category only."
              />
            </div>

            <h2 className="text-sm font-semibold text-ink-900 mb-3">Clubs</h2>

            {data.clubs.length === 0 ? (
              <Card>
                <Empty icon={Building2} title="No clubs yet">
                  Provision the first one to get started.
                </Empty>
              </Card>
            ) : (
              <ul className="space-y-2">
                {data.clubs.map((c) => (
                  <li key={c.clubId}>
                    <Card className="px-5 py-4 flex flex-wrap items-center gap-4">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="text-[14px] font-medium text-ink-900 truncate">
                            {c.name}
                          </p>
                          {c.status !== "Active" && (
                            <Badge tone="exception">{c.status === "Pending approval" ? "Waiting for admin approval" : c.status}</Badge>
                          )}
                        </div>
                        <p className="text-[12.5px] text-ink-500">
                          {c.clubType} · {c.memberCount} members
                          {c.town ? ` · ${c.town}` : ""} · since{" "}
                          {fmtDate(c.registrationDate)}
                        </p>
                      </div>

                      {c.status === "Active" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => setSuspending(c)}
                        >
                          <Ban size={13} aria-hidden />
                          Suspend
                        </Button>
                      ) : c.status === "Suspended" ? (
                        <Button
                          variant="secondary"
                          size="sm"
                          onClick={() => reinstate(c)}
                        >
                          <RotateCcw size={13} aria-hidden />
                          Reinstate
                        </Button>
                      ) : c.status === "Pending approval" ? (
                        <Button size="sm" onClick={() => setReviewing(c)}>Review application</Button>
                      ) : <p className="text-sm text-exc-700">{c.rejectionReason}</p>}
                    </Card>
                  </li>
                ))}
              </ul>
            )}
          </>
        ) : null}
      </main>

      {suspending && (
        <SuspendDialog
          club={suspending}
          onClose={() => setSuspending(null)}
          onDone={async () => {
            setSuspending(null);
            await load();
          }}
        />
      )}
    </div>
  );
}

function Stat({ icon: Icon, label, value, note, detail }) {
  return (
    <Card className="p-5">
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-500">{label}</p>
        <Icon size={15} className="text-ink-400 shrink-0" aria-hidden />
      </div>
      <p className="mt-2 font-mono tnum text-[24px] leading-none font-medium text-ink-900">
        {value}
      </p>
      {note && (
        <p className="mt-2 text-[12.5px] text-ink-500 leading-relaxed">
          {note}
        </p>
      )}
      {detail && (
        <details className="mt-3 text-sm">
          <summary className="cursor-pointer">View source totals</summary>
          {detail}
        </details>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------------------

function ProvisionedNotice({ result, onDismiss }) {
  return (
    <Card className="mb-5 border-pos-600/25 bg-pos-50/40 p-5">
      <div className="flex items-start gap-3">
        <span className="grid place-items-center w-8 h-8 rounded-full bg-pos-100 text-pos-700 shrink-0">
          <Check size={16} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-[14px] font-medium text-ink-900">
            {result.name} is provisioned
          </p>
          <p className="text-[13px] text-ink-700 mt-0.5">
            {result.chairperson.fullName} is its chairperson and can now sign in
            to capture the member register.
          </p>
          {result.chairperson.temporaryPassword && (
            <div className="mt-3 rounded-lg border border-warn-600/25 bg-warn-50 p-3">
              <p className="text-[12px] font-semibold text-warn-700">
                Temporary password — shown once
              </p>
              <code className="block mt-1.5 font-mono text-[15px] text-ink-900 select-all">
                {result.chairperson.temporaryPassword}
              </code>
              <p className="mt-1.5 text-[12px] text-warn-700">
                Give it to them directly. It cannot be read back.
              </p>
            </div>
          )}
        </div>
        <button
          onClick={onDismiss}
          className="shrink-0 grid place-items-center w-7 h-7 rounded hover:bg-ink-900/5 text-ink-400"
          aria-label="Dismiss"
        >
          <X size={15} />
        </button>
      </div>
    </Card>
  );
}

function SuspendDialog({ club, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await api.suspend(club.clubId, reason);
      onDone();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-5"
      role="dialog"
      aria-modal="true"
      aria-label={`Suspend ${club.name}`}
    >
      <Card className="w-full max-w-md p-5 shadow-pop animate-slideUp">
        <h2 className="text-sm font-semibold text-ink-900">
          Suspend {club.name}
        </h2>
        <p className="mt-1.5 text-[13px] text-ink-500 leading-relaxed">
          The club&rsquo;s officers will not be able to capture contributions,
          open cycles or make payouts. Its members keep read access to their own
          records throughout.
        </p>

        <div className="mt-4">
          <Field
            label="Reason"
            htmlFor="reason"
            required
            hint="Recorded in the audit log."
          >
            <Textarea
              id="reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Why is this club being suspended?"
            />
          </Field>
        </div>

        {error && (
          <Alert tone="exception" icon={AlertCircle} className="mt-3">
            {error}
          </Alert>
        )}

        <div className="mt-5 flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button variant="danger" onClick={submit} loading={busy}>
            Suspend the club
          </Button>
        </div>
      </Card>
    </div>
  );
}

// ---------------------------------------------------------------------------


function ReviewClub({ club, onClose, onDone }) {
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(null);
  async function review(decision) {
    setBusy(true); setError(null);
    try { await api.reviewClub(club.clubId, decision, reason); await onDone(); }
    catch (err) { setError(err.message); setBusy(false); }
  }
  return <Card className="p-5 mb-5 space-y-4">
    <h2 className="font-semibold">Review {club.name}</h2>
    <p className="text-sm">{club.clubType} · {club.memberCount} members · {club.town || "Town not supplied"}</p>
    <p className="text-sm text-ink-500">Approval activates this club. A Chairperson and Treasurer must be appointed first. Club finances and member details remain private.</p>
    <Field label="Reason if rejecting" htmlFor="reviewReason">
      <Textarea id="reviewReason" value={reason} onChange={e => setReason(e.target.value)} maxLength={2000} />
    </Field>
    {error && <Alert tone="exception">{error}</Alert>}
    <div className="flex gap-3 flex-wrap">
      <Button onClick={() => review("approve")} disabled={busy}>Approve club</Button>
      <Button variant="danger" onClick={() => review("reject")} disabled={busy || reason.trim().length < 3}>Reject club</Button>
      <Button variant="secondary" onClick={onClose} disabled={busy}>Cancel</Button>
    </div>
  </Card>;
}
