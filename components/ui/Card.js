import { cx } from "@/lib/format";

export function Card({ className, children, ...rest }) {
  return <div className={cx("bg-surface border border-line rounded-lg shadow-card", className)} {...rest}>{children}</div>;
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
