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
import { useRouter } from "next/navigation";
import ClubShell from "@/components/shell/ClubShell";
import { Loading } from "@/components/ui/States";
import { useSession } from "@/lib/session";

export default function ClubLayout({ children }) {
  const router = useRouter();
  const { status, club } = useSession();

  useEffect(() => {
    if (status === "signedOut") router.replace("/login");
    else if (status === "signedIn" && !club) router.replace("/select-club");
  }, [status, club, router]);

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

  return <ClubShell>{children}</ClubShell>;
}