import { cx } from "@/lib/format";

export function Table({ className, children }) {
  return (
    <div className="w-full overflow-x-auto no-scrollbar">
      <table className={cx("w-full text-sm border-collapse", className)}>{children}</table>
    </div>
  );
}
export function THead({ children }) {
  return <thead className="bg-canvas/70 border-y border-line">{children}</thead>;
}
export function TH({ children, className, align = "left", scope = "col" }) {
  return (
    <th scope={scope} className={cx("px-4 py-2.5 text-[12px] font-semibold uppercase tracking-wide text-ink-500", align === "right" && "text-right", align === "center" && "text-center", className)}>
      {children}
    </th>
  );
}
export function TR({ children, className, ...rest }) {
  return <tr className={cx("border-b border-line last:border-0 transition-colors", className)} {...rest}>{children}</tr>;
}
export function TD({ children, className, align = "left", ...rest }) {
  return <td className={cx("px-4 py-3 text-ink-700 align-middle", align === "right" && "text-right", align === "center" && "text-center", className)} {...rest}>{children}</td>;
}
