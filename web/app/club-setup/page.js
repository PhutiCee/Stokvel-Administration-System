"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import Button from "@/components/ui/Button";
import { Alert, Card, Loading } from "@/components/ui/States";
import { clubApplications } from "@/lib/api";
import { useSession } from "@/lib/session";
export default function ClubSetupPage() {
  const { status, club, role, refresh } = useSession();
  const router = useRouter();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const load = useCallback(async (signal) => {
    setBusy(true); setError(null);
    try { const d = await clubApplications.current({ signal }); setData(d); await refresh(signal); }
    catch (e) { if (e.name !== "AbortError") setError(e.message); }
    finally { setBusy(false); }
  }, [refresh]);
  useEffect(() => {
    if (status === "signedOut") { router.replace("/login"); return; }
    if (status !== "signedIn") return;
    if (!club) { router.replace("/select-club"); return; }
    const c = new AbortController(); load(c.signal); return () => c.abort();
  }, [status, club?.clubId, router, load]);
  return <main className="max-w-3xl mx-auto p-5 sm:p-8 space-y-5">
    <Link href="/select-club" className="text-accent-700">Back to my clubs</Link>
    <h1 className="text-2xl font-semibold">{data?.name || club?.name || "Club setup"}</h1>
    {error && <Alert tone="exception">{error}</Alert>}
    {!data ? <Loading label="Loading club status" /> : <Card className="p-5 space-y-4">
      <h2 className="text-lg font-semibold">{data.status === "Pending approval" ? "Waiting for admin approval" : data.status === "Rejected" ? "Application rejected" : `Club ${data.status.toLowerCase()}`}</h2>
      {data.status === "Pending approval" && <>
        <p>Contributions, payouts, voting and other club operations are unavailable until the Platform Administrator approves this club.</p>
        {role === "Chairperson" ? <>
          <p>You can register the Treasurer, Secretary and ordinary members now. A Treasurer must be appointed before approval.</p>
          <Link href="/members" className="text-accent-700 underline">Prepare membership</Link>
        </> : <p>Your Chairperson is preparing the club. You can return here to check approval.</p>}
      </>}
      {data.status === "Rejected" && <Alert tone="exception">{data.rejectionReason}</Alert>}
      {["Active", "Suspended"].includes(data.status) && <Link href="/dashboard" className="text-accent-700 underline">Open club</Link>}
      <div><Button variant="secondary" onClick={() => load()} disabled={busy}>Refresh approval status</Button></div>
    </Card>}
  </main>;
}
