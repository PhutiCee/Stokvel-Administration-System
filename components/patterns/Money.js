import { money as fmt, cx } from "@/lib/format";

/**
 * Money is never red for an outflow. Red is reserved for exceptions requiring a
 * human to act. An outflow is a normal, correct event and renders in neutral ink
 * with a minus sign. Tabular numerals so columns align on the decimal.
 */
export default function Money({ value, tone = "auto", size = "md", className, sign = false }) {
  const n = Number(value || 0);
  const tones = {
    auto: n > 0 && sign ? "text-pos-700" : "text-ink-900",
    plain: "text-ink-900", positive: "text-pos-700",
    muted: "text-ink-500", exception: "text-exc-600"
  };
  const sizes = { sm: "text-[13px]", md: "text-sm", lg: "text-lg font-semibold", xl: "text-2xl font-semibold", xxl: "text-[32px] leading-none font-semibold" };
  return <span className={cx("tnum", tones[tone], sizes[size], className)}>{fmt(n, { sign })}</span>;
}
