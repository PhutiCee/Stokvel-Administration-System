"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import ClubForm from "@/components/clubs/ClubForm";
import RegistrationAccess from "@/components/clubs/RegistrationAccess";
import { Alert, Card, Loading } from "@/components/ui/States";
import Button from "@/components/ui/Button";
import { auth, clubApplications } from "@/lib/api";
import { useSession } from "@/lib/session";
export default function CreateClubPage() {
  const { status, refresh } = useSession();
  const [eligibility,setEligibility] = useState(null), [error,setError] = useState(null), [result,setResult] = useState(null);
  useEffect(() => {
    if (status !== "signedIn") return;
    const c = new AbortController();
    clubApplications.eligibility({signal:c.signal}).then(setEligibility).catch(e => {if(e.name !== 'AbortError')setError(e.message);});
    return () => c.abort();
  }, [status]);
  if (result) return <main className="max-w-3xl mx-auto p-5 sm:p-8 space-y-5">
    <h1 className="text-2xl font-semibold">Waiting for admin approval</h1>
    <Card className="p-5 space-y-4">
      <p><strong>{result.name}</strong> has been submitted with its founding membership. Contributions, payouts, voting and other club operations will become available only after approval.</p>
      <p>Contact the Platform Administrator and quote your club name and application reference: <span className="break-all font-mono">{result.clubId}</span>.</p>
      <p>Save the new account details below and give each person only their own details. Existing members use their usual password. Temporary passwords are shown only now.</p>
      {result.foundingMembers?.map(p => <div key={p.memberId} className="border-t border-line pt-3 break-words">
        <p className="font-medium">{p.fullName} · {p.role}</p><p>Phone: {p.phone}</p>
        <p>{p.temporaryPassword ? <>Temporary password: <code>{p.temporaryPassword}</code></> : 'Existing account — use your current password.'}</p>
      </div>)}
      <Button as={Link} href="/club-setup">Check approval status</Button>
      <Link className="ml-4 underline" href="/select-club">My clubs</Link>
    </Card>
  </main>;
  return <main className="max-w-3xl mx-auto p-5 sm:p-8 space-y-5">
    <Link href={status === 'signedIn' ? '/select-club' : '/'} className="text-accent-700">{status === 'signedIn' ? 'Back to my clubs' : 'Back to home'}</Link>
    <h1 className="text-2xl font-semibold">Register a club</h1>
    <p>Set up your club, appoint a Chairperson, Treasurer and Secretary, and include at least one ordinary member. Submit the complete application for admin approval.</p>
    {status === 'signedOut' ? <RegistrationAccess /> : status === 'loading' ? <Loading /> : error ? <Alert tone="exception">{error}</Alert> : !eligibility ? <Loading label="Loading registration" /> : !eligibility.canCreate ? <Alert>Use a personal account to register a club. Platform administrators can provision clubs from their dashboard.</Alert> :
      <ClubForm selfChairperson applicant={eligibility.applicant} submitClub={clubApplications.create} onCancel={() => window.location.assign('/select-club')} onDone={async created => {
        setResult(created);
        try { await auth.selectClub(created.clubId); await refresh(); } catch { /* Submission succeeded; My clubs remains available. */ }
        window.scrollTo(0,0);
      }} />}
  </main>;
}
