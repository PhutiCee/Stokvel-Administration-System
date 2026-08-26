"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Building2, Users, Landmark, EyeOff, LogOut, BookLock, ShieldCheck } from "lucide-react";
import { useSession, useData, useQuery } from "@/lib/data";
import { money, fmtDate } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, THead, TH, TR, TD } from "@/components/ui/Table";
import { Alert, SkeletonRows } from "@/components/ui/States";
import Badge from "@/components/ui/Badge";
import StatusBadge from "@/components/patterns/StatusBadge";
import PageHeader from "@/components/patterns/PageHeader";

/**
 * BR-10 / REQ-19 / REQ-114. The Platform Administrator is a custodian of the
 * platform, not of the money. This surface is deliberately a different shell with
 * a different navigation, rather than the club shell with items greyed out —
 * because the point is not that this person is denied a few buttons, it is that
 * club money is outside their world entirely.
 */
export default function PlatformPage() {
  const router = useRouter();
  const { user, isPlatformAdmin, signOut } = useSession();
  const d = useData();

  useEffect(() => {
    if (!user) router.replace("/login");
    else if (!isPlatformAdmin) router.replace("/select-club");
  }, [user, isPlatformAdmin, router]);

  const { data, loading } = useQuery(() => ({
    aggregate: d.platformAggregate(),
    clubs: d.state.clubs.map((c) => ({
      ...c,
      memberCount: d.activeMembers(c.id).length,
      constitution: d.constitutionFor(c.id)
    }))
  }), []);

  if (!user || !isPlatformAdmin) return null;

  return (
    <div className="min-h-screen bg-canvas">
      <header className="bg-navy-950 text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-14 flex items-center justify-between on-navy">
          <div className="flex items-center gap-2.5">
            <span className="w-7 h-7 rounded-md bg-accent-600 grid place-items-center"><BookLock size={15} aria-hidden /></span>
            <span className="text-[13px] font-semibold">Platform administration</span>
            <Badge tone="neutral" className="bg-white/10 text-white/70 ring-white/15 ml-1">Platform level</Badge>
          </div>
          <button onClick={() => { signOut(); router.push("/login"); }}
            className="flex items-center gap-1.5 text-[13px] text-white/60 hover:text-white transition-colors">
            <LogOut size={14} aria-hidden /> Sign out
          </button>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-5 sm:px-8 py-8">
        <PageHeader
          title={`Platform overview`}
          description="Clubs, membership and total funds under administration, in aggregate."
        />

        <Alert tone="neutral" icon={EyeOff} className="mb-6" title="You cannot see inside any club, and that is deliberate">
          This role provisions and suspends clubs and watches the health of the platform. It has no access to any
          member's record, any transaction or any club's ledger. A platform operator who could read the books
          would be one more person the members have to trust (BR-10, REQ-19).
        </Alert>

        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4 mb-6">
          {[
            ["Clubs", data?.aggregate.clubs, Building2, false],
            ["Active clubs", data?.aggregate.activeClubs, ShieldCheck, false],
            ["Members", data?.aggregate.members, Users, false],
            ["Funds under administration", data?.aggregate.fundsUnderAdministration, Landmark, true]
          ].map(([label, value, Icon, isMoney]) => (
            <Card key={label} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <p className="text-[13px] font-medium text-ink-500">{label}</p>
                <Icon size={15} className="text-ink-400 shrink-0" aria-hidden />
              </div>
              <p className="text-2xl font-semibold tnum mt-2.5">
                {loading ? "—" : isMoney ? money(value) : value}
              </p>
            </Card>
          ))}
        </div>

        <Card>
          <CardHeader title="Clubs on the platform" description="Names, types and sizes only. No financial detail." />
          {loading ? <SkeletonRows rows={4} cols={4} /> : (
            <Table>
              <THead>
                <TR><TH>Club</TH><TH>Type</TH><TH align="right">Members</TH><TH>Registered</TH><TH>Status</TH></TR>
              </THead>
              <tbody>
                {data.clubs.map((c) => (
                  <TR key={c.id}>
                    <TD>
                      <p className="text-[14px] font-medium text-ink-900">{c.name}</p>
                      <p className="text-[12px] text-ink-500">{c.town}</p>
                    </TD>
                    <TD><Badge tone="neutral">{c.type}</Badge></TD>
                    <TD align="right" className="tnum">{c.memberCount}</TD>
                    <TD className="tnum text-[13px] whitespace-nowrap">{fmtDate(c.registrationDate)}</TD>
                    <TD><StatusBadge status={c.status} /></TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          )}
          <CardBody className="border-t border-line bg-canvas/50">
            <p className="text-[12px] text-ink-500 leading-relaxed">
              Club provisioning and suspension belong on this screen and are designed but not built in this
              prototype. Suspension makes a club read-only: members keep access to their own history, and every
              write is refused (REQ-21).
            </p>
          </CardBody>
        </Card>
      </main>
    </div>
  );
}
