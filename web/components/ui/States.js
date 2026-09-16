"use client";

import { cx } from "@/lib/format";
import { Loader2 } from "lucide-react";

// --- Card -------------------------------------------------------------------
export function Card({ className, children, ...rest }) {
  return (
    <div className={cx("bg-surface border border-line rounded-lg shadow-card", className)} {...rest}>
      {children}
    </div>
  );
}

export function CardHeader({ title, description, action, className }) {
  return (
    <div className={cx("flex items-start justify-between gap-4 px-5 py-4 border-b border-line", className)}>
      <div className="min-w-0">
        <h3 className="text-sm font-semibold text-ink-900">{title}</h3>
        {description && <p className="text-[13px] text-ink-500 mt-0.5">{description}</p>}
      </div>
      {action}
    </div>
  );
}

export function CardBody({ className, children }) {
  return <div className={cx("p-5", className)}>{children}</div>;
}

// --- Badge ------------------------------------------------------------------
// Every tone carries a meaning. There is no "just to add colour" tone.
const BADGE_TONES = {
  neutral: "bg-ink-900/5 text-ink-700 ring-ink-900/10",
  accent: "bg-accent-50 text-accent-700 ring-accent-600/20",
  positive: "bg-pos-50 text-pos-700 ring-pos-600/20",
  attention: "bg-warn-50 text-warn-700 ring-warn-600/25",
  exception: "bg-exc-50 text-exc-700 ring-exc-600/20"
};

export function Badge({ tone = "neutral", icon: Icon, children, className }) {
  return (
    <span
      className={cx(
        "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset",
        BADGE_TONES[tone],
        className
      )}
    >
      {Icon && <Icon size={12} aria-hidden />}
      {children}
    </span>
  );
}

/** Maps a member's standing to the tone that states its seriousness. */
export function StandingBadge({ standing }) {
  const tone =
    standing === "Good standing" ? "positive"
    : standing === "In arrears" ? "exception"
    : standing === "Exited" ? "neutral"
    : "attention";
  return <Badge tone={tone}>{standing}</Badge>;
}

// --- Alert ------------------------------------------------------------------
const ALERT_TONES = {
  info: "bg-accent-50 text-accent-700 border-accent-600/20",
  positive: "bg-pos-50 text-pos-700 border-pos-600/20",
  attention: "bg-warn-50 text-warn-700 border-warn-600/25",
  exception: "bg-exc-50 text-exc-700 border-exc-600/20"
};

export function Alert({ tone = "info", icon: Icon, title, children, className }) {
  return (
    <div
      role={tone === "exception" ? "alert" : "status"}
      className={cx("rounded-lg border px-3.5 py-3 text-[13px] leading-relaxed", ALERT_TONES[tone], className)}
    >
      <div className="flex gap-2.5">
        {Icon && <Icon size={15} className="shrink-0 mt-0.5" aria-hidden />}
        <div className="min-w-0">
          {title && <p className="font-semibold mb-0.5">{title}</p>}
          <div>{children}</div>
        </div>
      </div>
    </div>
  );
}

// --- Loading and empty ------------------------------------------------------
export function Loading({ label = "Loading", className }) {
  return (
    <div className={cx("flex items-center justify-center gap-2.5 py-14 text-ink-500", className)}>
      <Loader2 size={16} className="animate-spin" aria-hidden />
      <span className="text-sm">{label}</span>
    </div>
  );
}

/**
 * An empty screen is an invitation to act, so it names what is missing and what
 * to do about it rather than saying "no data".
 */
export function Empty({ icon: Icon, title, children, action, className }) {
  return (
    <div className={cx("text-center py-14 px-6", className)}>
      {Icon && (
        <span className="inline-grid place-items-center w-11 h-11 rounded-full bg-ink-900/5 text-ink-400 mb-3.5">
          <Icon size={19} aria-hidden />
        </span>
      )}
      <p className="text-sm font-semibold text-ink-900">{title}</p>
      {children && <p className="text-[13px] text-ink-500 mt-1 max-w-sm mx-auto leading-relaxed">{children}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}