"use client";

/**
 * Guard for every in-club route.
 *
 * Three states have to be distinguished, and collapsing them produces a
 * confusing interface:
 *
 *   not signed in       -> /login
 *   signed in, no club  -> /select-club
 *   signed in, in club  -> render
 *
 * This is a convenience, not a security control. A person who types
 * /members directly without a session gets redirected here, but even if this
 * file did nothing, the API would refuse every request the page made. The
 * server is the boundary; this just avoids showing an empty screen.
 */

import { useEffect } from "react";
import { useRouter, usePathname } from "next/navigation";
import Link from "next/link";
import ClubShell from "@/components/shell/ClubShell";
import { Loading } from "@/components/ui/States";
import { useSession } from "@/lib/session";

export default function ClubLayout({ children }) {
  const router = useRouter();
  const { status, club, role } = useSession();
  const pathname = usePathname();
  const awaitingReview = ["Pending approval", "Rejected"].includes(club?.status);
  const membershipSetup = club?.status === "Pending approval" && role === "Chairperson" && pathname === "/members";

  useEffect(() => {
    if (status === "signedOut") router.replace("/login");
    else if (status === "signedIn" && !club) router.replace("/select-club");
    else if (status === "signedIn" && awaitingReview && !membershipSetup) router.replace("/club-setup");
  }, [status, club, router, awaitingReview, membershipSetup]);

  if (status === "loading") {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loading label="Checking your session" />
      </div>
    );
  }

  if (status === "signedOut" || !club) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loading label="Taking you to the right place" />
      </div>
    );
  }

  if (awaitingReview) {
    if (!membershipSetup) return <Loading label="Opening club setup" />;
    return <main className="max-w-5xl mx-auto p-5 sm:p-8 space-y-5">
      <div className="flex gap-5"><Link href="/select-club">My clubs</Link><Link href="/club-setup">Club approval status</Link></div>
      <p className="p-4 rounded border border-line bg-surface">Waiting for admin approval. Membership setup only.</p>
      {children}
    </main>;
  }
  return <ClubShell>{children}</ClubShell>;
}