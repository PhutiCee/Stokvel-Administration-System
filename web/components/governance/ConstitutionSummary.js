"use client";
import { Card } from "@/components/ui/States";
import { money } from "@/lib/format";
export default function ConstitutionSummary({value:k}) {
  return <Card className="p-5 my-5" id="constitution">
    <h2 className="font-semibold">Constitution version {k.version}</h2>
    <p className="text-sm">Effective {k.effectiveDate}. Open cycles keep the rules bound at commencement.</p>
    <dl className="grid sm:grid-cols-2 gap-3 text-sm mt-3">
      {Object.entries({Contribution:money(k.contributionAmount),Frequency:k.cycleFrequency,'Late penalty':money(k.penaltyAmount),'Grace period':`${k.gracePeriodDays} days`,Quorum:`${k.quorumPercentage}%`,'Exit notice':`${k.exitNoticeDays} days`,'Payout order':k.payoutOrderMethod,'Forfeiture rule':k.forfeitureRule,'Burial waiting period':k.waitingPeriodDays==null?null:`${k.waitingPeriodDays} days`,'Year-end':k.yearEndMonth?`${k.yearEndMonth}-${k.yearEndDay}`:null}).filter(([,v])=>v!=null).map(([label,value])=><div key={label}><dt className="text-ink-500">{label}</dt><dd>{value}</dd></div>)}
    </dl>
    {!!k.benefitSchedule?.length && <ul className="mt-3 text-sm">{k.benefitSchedule.map(b=><li key={b.category}>{b.category}: {money(b.amount)}</li>)}</ul>}
  </Card>;
}
