"use client";
import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import ClubForm from "@/components/clubs/ClubForm";
import { Alert, Loading } from "@/components/ui/States";
import { auth, clubApplications } from "@/lib/api";
import { useSession } from "@/lib/session";
export default function CreateClubPage() {
  const { status, refresh } = useSession();
  const router = useRouter();
  const [eligible, setEligible] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    if (status === "signedOut") { router.replace("/login"); return; }
    if (status !== "signedIn") return;
    const c = new AbortController();
    clubApplications.eligibility({ signal: c.signal }).then(d => setEligible(d.canCreate)).catch(e => {
      if (e.name !== "AbortError") setError(e.message);
    });
    return () => c.abort();
  }, [status, router]);
  return <main className="max-w-3xl mx-auto p-5 sm:p-8 space-y-5">
    <Link href="/select-club" className="text-accent-700">Back to my clubs</Link>
    <h1 className="text-2xl font-semibold">Create a club</h1>
    <p>You become its Chairperson. You can prepare the membership while waiting for admin approval. Appoint a Treasurer before approval.</p>
    {error ? <Alert tone="exception">{error}</Alert> : eligible === null ? <Loading label="Checking your access" /> : !eligible ?
      <Alert>You must be a Chairperson of an active club to create a club application.</Alert> :
      <ClubForm selfChairperson submitClub={clubApplications.create} onCancel={() => router.push("/select-club")} onDone={async result => {
        // Creation succeeded; navigate even if selecting the new context fails.
        try { await auth.selectClub(result.clubId); await refresh(); router.push("/club-setup"); }
        catch { router.push("/select-club"); }
      }} />}
  </main>;
}
