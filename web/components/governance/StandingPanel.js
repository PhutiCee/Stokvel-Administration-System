"use client";
import { useEffect,useState } from "react";
import { api } from "@/lib/api";
import { Card,Alert,Badge } from "@/components/ui/States";
export default function StandingPanel() {
  const [data,setData]=useState(null),[error,setError]=useState('');
  useEffect(()=>{const c=new AbortController();api.get('/api/governance/standing',{signal:c.signal}).then(setData).catch(e=>{if(e.name!=='AbortError')setError(e.message);});return()=>c.abort();},[]);
  if(error)return <Alert tone="exception">{error}</Alert>;
  if(!data)return null;
  return <Card className="p-5 my-5 space-y-3">
    <h2 className="font-semibold">Member standing</h2>
    {!data.configured?<Alert tone="attention">Adopt warning, suspension and expulsion-review thresholds through a constitution amendment before automatic advancement can run. If the existing voting policy does not cover these fields, amend its class assignments first.</Alert>:<p className="text-sm">Missed contributions: warning at {data.thresholds.warningAfterMissed}, suspension at {data.thresholds.suspensionAfterMissed}, expulsion review at {data.thresholds.expulsionAfterMissed}. Expulsion always requires a carried member resolution.</p>}
    {data.members.filter(m=>m.standing!=='Good standing').map(m=><div key={m.memberId} className="flex justify-between gap-3 text-sm"><span>{m.fullName} · {m.missedContributions} missed</span><Badge>{m.needsResolution?'Expulsion review':m.standing}</Badge></div>)}
    <details><summary className="cursor-pointer text-sm">Standing history</summary><ul className="mt-2 space-y-2 text-sm">{data.history.map(h=><li key={h.changeId}>{h.changedOn} · {data.members.find(m=>m.memberId===h.memberId)?.fullName || 'Former member'}: {h.from} → {h.to}</li>)}</ul></details>
  </Card>;
}
