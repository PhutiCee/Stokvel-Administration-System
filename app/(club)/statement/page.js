"use client";

import { Printer, FileText, Info } from "lucide-react";
import { useSession, useData, useQuery } from "@/lib/data";
import { money, fmtDate, fmtDateTime } from "@/lib/format";
import { Card, CardHeader, CardBody } from "@/components/ui/Card";
import { Table, THead, TH, TR, TD } from "@/components/ui/Table";
import { Alert, EmptyState, SkeletonRows } from "@/components/ui/States";
import Button from "@/components/ui/Button";
import Money from "@/components/patterns/Money";
import Badge from "@/components/ui/Badge";
import PageHeader from "@/components/patterns/PageHeader";

/**
 * REQ-94 and REQ-100. The export requirement asks for a portable document; the
 * prototype uses a print stylesheet instead, which produces a real, usable
 * document in the browser without a PDF pipeline. The production build adds a
 * server-rendered PDF and a delimited export.
 */
export default function StatementPage() {
  const { club, membership } = useSession();
  const d = useData();

  const { data, loading } = useQuery(() => {
    if (!club || !membership) return null;
    return {
      entries: d.memberStatement(club.id, membership.id),
      balance: d.memberBalance(club.id, membership.id),
      pool: d.poolBalance(club.id)
    };
  }, [club?.id, membership?.id]);

  if (!club || !membership) return null;

  return (
    <>
      <div className="no-print">
        <PageHeader
          title="My statement"
          description="Everything that has affected your account in this club, oldest first, with a running total."
          actions={<Button variant="secondary" onClick={() => window.print()}><Printer size={15} /> Print or save as PDF</Button>}
        />
      </div>

      {/* Print letterhead, hidden on screen */}
      <div className="hidden print:block mb-6">
        <h1 className="text-xl font-semibold">{club.name}</h1>
        <p className="text-sm">Member statement — {membership.fullName}</p>
        <p className="text-xs text-ink-500 mt-1">Produced {fmtDateTime(new Date())}. Figures taken from the club ledger.</p>
      </div>

      <div className="grid sm:grid-cols-4 gap-3 mb-5">
        {[
          ["Paid in total", data?.balance.paid],
          ["Outstanding", data?.balance.outstanding],
          ["Penalties", data?.balance.penalties],
          ["Received from the pool", data?.balance.received]
        ].map(([label, value]) => (
          <Card key={label} className="p-4">
            <p className="text-[11px] uppercase tracking-wide text-ink-400">{label}</p>
            <p className="mt-1.5"><Money value={value ?? 0} size="lg" tone={label === "Outstanding" && value > 0 ? "exception" : "plain"} /></p>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader
          title="Statement"
          description={`${membership.fullName} · ${club.name} · as at ${fmtDate(new Date())}`}
          action={<Badge tone="neutral" className="no-print">{data?.entries.length ?? 0} entries</Badge>}
        />
        {loading ? <SkeletonRows rows={8} cols={4} /> : data.entries.length === 0 ? (
          <EmptyState icon={FileText} title="Nothing on your account yet"
            description="Once your treasurer captures your first contribution, it appears here." />
        ) : (
          <Table>
            <THead>
              <TR><TH>Date</TH><TH>What happened</TH><TH align="right">Amount</TH><TH align="right">Running total</TH></TR>
            </THead>
            <tbody>
              {data.entries.map((e) => {
                const reversed = d.ledgerFor(club.id).some((x) => x.reversesId === e.id);
                return (
                  <TR key={e.id}>
                    <TD className="tnum whitespace-nowrap text-[13px]">{fmtDate(e.postedAt)}</TD>
                    <TD>
                      <p className={reversed ? "text-[13px] text-ink-400 line-through" : "text-[13px] text-ink-900"}>{e.description}</p>
                      {e.reason && <p className="text-[12px] text-ink-500 italic mt-0.5">{e.reason}</p>}
                    </TD>
                    <TD align="right"><Money value={e.amount} size="sm" sign tone={e.amount > 0 ? "positive" : "plain"} /></TD>
                    <TD align="right"><Money value={e.running} size="sm" tone="muted" /></TD>
                  </TR>
                );
              })}
            </tbody>
          </Table>
        )}
        <CardBody className="border-t border-line bg-canvas/50">
          <p className="text-[12px] text-ink-500 leading-relaxed">
            Every figure here comes from the club's ledger, the same record your officers see. If something looks
            wrong, ask your treasurer: an error is corrected by a reversing entry, which will appear on this
            statement alongside the original.
          </p>
        </CardBody>
      </Card>

      <Alert tone="neutral" icon={Info} className="mt-5 no-print">
        The SRS asks for export to a portable document format (REQ-100). The prototype uses the browser's own
        print output, which is genuinely usable; a server-rendered PDF and a delimited export come with production.
      </Alert>
    </>
  );
}
