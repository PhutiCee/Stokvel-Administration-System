import { cx } from "@/lib/format";
import { Inbox } from "lucide-react";

export function Skeleton({ className }) { return <div className={cx("skeleton", className)} aria-hidden />; }

export function SkeletonRows({ rows = 5, cols = 4 }) {
  return (
    <div className="divide-y divide-line" aria-busy="true" aria-label="Loading">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3.5">
          {Array.from({ length: cols }).map((_, j) => (
            <Skeleton key={j} className={cx("h-3.5", j === 0 ? "w-2/5" : "flex-1")} />
          ))}
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon: Icon = Inbox, title, description, action, className }) {
  return (
    <div className={cx("flex flex-col items-center text-center px-6 py-14", className)}>
      <div className="w-11 h-11 rounded-full bg-canvas border border-line flex items-center justify-center mb-3.5">
        <Icon size={19} className="text-ink-400" aria-hidden />
      </div>
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      {description && <p className="text-[13px] text-ink-500 mt-1 max-w-sm leading-relaxed">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function Alert({ tone = "info", title, children, icon: Icon, className, action }) {
  const tones = {
    info: "bg-accent-50 border-accent-600/20 text-accent-700",
    warning: "bg-warn-50 border-warn-600/25 text-warn-700",
    exception: "bg-exc-50 border-exc-600/25 text-exc-700",
    positive: "bg-pos-50 border-pos-600/25 text-pos-700",
    neutral: "bg-canvas border-line text-ink-700"
  };
  return (
    <div className={cx("rounded-lg border px-4 py-3 flex items-start gap-3", tones[tone], className)} role={tone === "exception" ? "alert" : undefined}>
      {Icon && <Icon size={17} className="shrink-0 mt-0.5" aria-hidden />}
      <div className="min-w-0 flex-1">
        {title && <p className="text-[13px] font-semibold">{title}</p>}
        <div className="text-[13px] leading-relaxed opacity-95">{children}</div>
      </div>
      {action}
    </div>
  );
}
