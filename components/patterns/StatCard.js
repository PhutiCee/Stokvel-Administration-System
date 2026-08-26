import { Card } from "@/components/ui/Card";
import Money from "./Money";
import { Skeleton } from "@/components/ui/States";
import { cx } from "@/lib/format";
import Link from "next/link";
import { ArrowUpRight } from "lucide-react";

export default function StatCard({ label, value, isMoney = true, hint, tone = "plain", loading, href, icon: Icon }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <p className="text-[13px] font-medium text-ink-500">{label}</p>
        {Icon && <Icon size={15} className="text-ink-400 shrink-0" aria-hidden />}
      </div>
      <div className="mt-2.5">
        {loading ? <Skeleton className="h-7 w-28" />
          : isMoney ? <Money value={value} size="xl" tone={tone} />
            : <span className={cx("tnum text-2xl font-semibold", tone === "exception" ? "text-exc-600" : "text-ink-900")}>{value}</span>}
      </div>
      {hint && <p className={cx("text-[12px] mt-1.5", tone === "exception" ? "text-exc-600" : "text-ink-500")}>{hint}</p>}
      {href && (
        <span className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-accent-600 group-hover:gap-1.5 transition-all">
          View detail <ArrowUpRight size={12} />
        </span>
      )}
    </>
  );
  const cls = cx("p-4 group transition-shadow", href && "hover:shadow-pop cursor-pointer");
  return href
    ? <Card className={cls}><Link href={href} className="block">{body}</Link></Card>
    : <Card className={cls}>{body}</Card>;
}
