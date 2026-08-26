"use client";
import { cx } from "@/lib/format";
import { Loader2 } from "lucide-react";

const VARIANTS = {
  primary: "bg-accent-600 text-white hover:bg-accent-700 disabled:bg-accent-600/40 shadow-sm",
  secondary: "bg-surface text-ink-900 border border-line-strong hover:bg-canvas disabled:text-ink-400",
  ghost: "bg-transparent text-ink-700 hover:bg-ink-900/5 disabled:text-ink-400",
  danger: "bg-exc-600 text-white hover:bg-exc-700 disabled:bg-exc-600/40",
  onNavy: "bg-white/10 text-white hover:bg-white/20 border border-white/15"
};
const SIZES = { sm: "h-8 px-3 text-[13px] gap-1.5", md: "h-10 px-4 text-sm gap-2", lg: "h-11 px-5 text-[15px] gap-2" };

export default function Button({ as: Tag = "button", variant = "primary", size = "md", loading, className, children, ...rest }) {
  return (
    <Tag
      className={cx(
        "inline-flex items-center justify-center rounded font-medium transition-colors duration-150",
        "disabled:cursor-not-allowed select-none whitespace-nowrap",
        VARIANTS[variant], SIZES[size], className
      )}
      {...rest}
    >
      {loading && <Loader2 size={15} className="animate-spin" aria-hidden />}
      {children}
    </Tag>
  );
}
