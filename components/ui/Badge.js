import { cx } from "@/lib/format";

const TONES = {
  neutral: "bg-ink-900/5 text-ink-700 ring-ink-900/10",
  accent: "bg-accent-50 text-accent-700 ring-accent-600/20",
  positive: "bg-pos-50 text-pos-700 ring-pos-600/20",
  attention: "bg-warn-50 text-warn-700 ring-warn-600/25",
  exception: "bg-exc-50 text-exc-700 ring-exc-600/20"
};

export default function Badge({ tone = "neutral", icon: Icon, children, className }) {
  return (
    <span className={cx("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[12px] font-medium ring-1 ring-inset", TONES[tone], className)}>
      {Icon && <Icon size={12} aria-hidden />}
      {children}
    </span>
  );
}
