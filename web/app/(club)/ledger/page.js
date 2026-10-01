"use client";

/**
 * The ledger. REQ-88 to REQ-92.
 *
 * Set as a book of account, not as a data table: the running balance is the
 * right-hand column, in the mono face, and it runs continuously down the page.
 * A reader should be able to follow it with a finger and have every line add
 * up — which is exactly the property that makes an append-only ledger worth
 * having, and exactly what a gap in it would reveal.
 */

import { useEffect, useState, useCallback } from "react";
import { AlertCircle, BookOpen } from "lucide-react";
import { useSession } from "@/lib/session";
import Button from "@/components/ui/Button";
import ConfirmDialog from "@/components/ui/ConfirmDialog";
import ReversalRequests from "@/components/ledger/ReversalRequests";
import { PageHeader } from "@/components/shell/ClubShell";
import { Card, Badge, Alert, Loading, Empty } from "@/components/ui/States";
import { ledger as api, ApiError } from "@/lib/api";
import { money, isNegativeAmount, fmtDateTime, cx } from "@/lib/format";

const TYPE_TONE = {
  Contribution: "positive",
  Penalty: "attention",
  Payout: "neutral",
  Claim: "neutral",
  Interest: "positive",
  Expense: "attention",
  Reversal: "exception",
  Adjustment: "attention"
};

export default function LedgerPage() {
  const {can}=useSession();
  const [reversing,setReversing]=useState(null);
  const [requests,setRequests]=useState([]);
  const [notice,setNotice]=useState("");
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  const load=useCallback(async(signal)=>{
    const [book,pending]=await Promise.all([api.list(100,{signal}),api.reversals({signal})]);
    if(signal?.aborted)return;
    setData(book);setRequests(pending.requests);setError(null);
  },[]);
  useEffect(()=>{
    const c=new AbortController();load(c.signal).catch(err=>{if(!c.signal.aborted)setError(err.message);});
    return ()=>c.abort();
  },[load]);

  if (error) {
    return <Alert tone="exception" icon={AlertCircle} title="Could not load the ledger">{error}</Alert>;
  }
  if (!data) return <Loading label="Loading the ledger" />;

  return (
    <>
      <PageHeader
        title="Ledger"
        description="Every entry, newest first. Entries cannot be edited or removed by anyone — a mistake is corrected by a reversing entry, and both lines stay in the book."
        action={
          <div className="text-right">
            <p className="text-[12.5px] text-ink-500">Pool balance</p>
            <p className="font-mono tnum text-[20px] font-medium text-ink-900">
              {money(data.poolBalance)}
            </p>
          </div>
        }
      />

      {notice && <p role="status" className="mb-4 text-sm">{notice}</p>}
      <ReversalRequests requests={requests} onChanged={()=>load()} />
      {reversing && <ConfirmDialog title={['Payout','Claim'].includes(reversing.entryType)?"Request payout reversal":"Reverse ledger entry"}
        description={`Original: ${money(reversing.amount)}. An equal and opposite entry will be posted${['Payout','Claim'].includes(reversing.entryType)?' only after Chairperson approval and a Treasurer confirms posting':''}. Recorded allocations and supported payout effects will be corrected atomically. Original records remain. Conflicting later activity prevents posting.`}
        confirmLabel={['Payout','Claim'].includes(reversing.entryType)?"Request approval":"Post reversal"}
        onClose={()=>setReversing(null)} onConfirm={async reason=>{
          const result=await api.reverse(reversing.entryId,reason);
          setNotice(result.status==='Pending'?'Requested: awaiting Chairperson approval.':'Reversing entry posted.');
          await load();
        }} />}

      {data.entries.length === 0 ? (
        <Card>
          <Empty icon={BookOpen} title="The book is empty">
            Entries appear here as contributions are captured and payouts are made.
          </Empty>
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-[13.5px] border-collapse min-w-[720px]">
              <caption className="sr-only">
                Club ledger, newest entry first, with a running balance
              </caption>
              <thead>
                <tr className="bg-canvas/70 border-b border-line text-ink-500 text-left">
                  <th scope="col" className="font-medium px-5 py-2.5">Date</th>
                  <th scope="col" className="font-medium py-2.5">Entry</th>
                  <th scope="col" className="font-medium py-2.5">Type</th>
                  <th scope="col" className="font-medium py-2.5 text-right">Amount</th>
                  <th scope="col" className="font-medium px-5 py-2.5 text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                {data.entries.map((e) => {
                  const out = isNegativeAmount(e.amount);
                  const reversal = !!e.reversesId;
                  return (
                    <tr
                      key={e.entryId}
                      className={cx("border-b border-line last:border-0", reversal && "bg-exc-50/40")}
                    >
                      <td className="px-5 py-3 text-ink-500 whitespace-nowrap font-mono tnum text-[12.5px]">
                        {fmtDateTime(e.postedAt)}
                      </td>

                      <td className="py-3 pr-3">
                        <p className="text-ink-900">{e.description}</p>
                        <p className="text-[12px] text-ink-500">
                          Posted by {e.postedByName}
                          {e.reference ? ` · ${e.reference}` : ""}
                        </p>
                        {e.reversedBy && <p className="text-xs mt-1">Already reversed</p>}
                        {e.reversesId && <p className="text-xs mt-1 break-all">Reverses entry {e.reversesId}</p>}
                        {can("ledger.reverse") && !e.reversedBy && !e.reversesId && !['Reversal','Penalty'].includes(e.entryType) &&
                          !requests.some(r=>r.entry_id===e.entryId && r.status!=='Rejected') &&
                          <Button size="sm" variant="secondary" className="mt-2" onClick={()=>setReversing(e)}>{['Payout','Claim'].includes(e.entryType)?'Request reversal':'Reverse'}</Button>}
                        {e.reason && (
                          <p className="text-[12px] text-exc-700 mt-0.5">Reason: {e.reason}</p>
                        )}
                      </td>

                      <td className="py-3">
                        <Badge tone={TYPE_TONE[e.entryType] || "neutral"}>{e.entryType}</Badge>
                      </td>

                      <td
                        className={cx(
                          "py-3 text-right font-mono tnum whitespace-nowrap",
                          out ? "text-exc-700" : "text-ink-900"
                        )}
                      >
                        {money(e.amount, { sign: true })}
                      </td>

                      <td className="px-5 py-3 text-right font-mono tnum text-ink-500 whitespace-nowrap">
                        {money(e.resultingBalance)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <p className="mt-5 text-[13px] text-ink-500 leading-relaxed">
        Showing the {data.entries.length} most recent of {data.entryCount} entries. The pool balance
        is the sum of every entry in the book — it is not stored anywhere separately, so it cannot
        disagree with the ledger.
      </p>
    </>
  );
}