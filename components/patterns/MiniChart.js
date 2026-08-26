"use client";
import { fmtMonth, money } from "@/lib/format";

/**
 * REQ-115: income and expenditure as a monthly series over the preceding twelve
 * months. Hand-rolled SVG rather than a charting library, because the payload
 * budget in SRS 5.1 is 500 KB compressed and this is the only chart in the system.
 */
export default function MiniChart({ series }) {
  const max = Math.max(1, ...series.flatMap((s) => [s.income, s.expenditure]));
  return (
    <div className="w-full">
      <div className="flex items-end gap-1.5 h-40" role="img" aria-label="Monthly income and expenditure over twelve months">
        {series.map((m, i) => (
          <div key={i} className="flex-1 flex flex-col justify-end items-center gap-1 group relative">
            <div className="w-full flex items-end justify-center gap-[2px] h-full">
              <div className="w-1/2 bg-accent-600/85 rounded-t-[2px] transition-all duration-200 group-hover:bg-accent-600"
                style={{ height: `${(m.income / max) * 100}%` }} />
              <div className="w-1/2 bg-ink-400/60 rounded-t-[2px] transition-all duration-200 group-hover:bg-ink-500"
                style={{ height: `${(m.expenditure / max) * 100}%` }} />
            </div>
            <div className="absolute -top-1 hidden group-hover:block z-10 whitespace-nowrap bg-navy-950 text-white text-[11px] rounded px-2 py-1 shadow-pop pointer-events-none">
              <span className="tnum">In {money(m.income)} · Out {money(m.expenditure)}</span>
            </div>
          </div>
        ))}
      </div>
      <div className="flex gap-1.5 mt-2">
        {series.map((m, i) => (
          <span key={i} className="flex-1 text-center text-[10px] text-ink-400 truncate">{fmtMonth(m.label)}</span>
        ))}
      </div>
      <div className="flex items-center gap-4 mt-3 text-[12px] text-ink-500">
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-accent-600/85" />Contributions in</span>
        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-ink-400/60" />Payouts out</span>
      </div>
    </div>
  );
}
