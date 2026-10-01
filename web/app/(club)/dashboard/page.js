"use client";
import DashboardDetails from "@/components/DashboardDetails";
import { PageHeader } from "@/components/shell/ClubShell";
import { useSession } from "@/lib/session";
export default function DashboardPage() {
  const { user, club, role } = useSession();
  return (
    <>
      <PageHeader
        title={`Good day, ${user?.fullName?.split(" ")[0] || ""}`}
        description={`${club?.name || "Your club"} · ${role}`}
      />
      <DashboardDetails />
    </>
  );
}
