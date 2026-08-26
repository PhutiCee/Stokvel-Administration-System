import { cx } from "@/lib/format";

export default function PageHeader({ title, description, actions, meta, className }) {
  return (
    <div className={cx("flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between mb-6", className)}>
      <div className="min-w-0">
        <h1 className="text-xl sm:text-2xl font-semibold text-ink-900 tracking-[-0.01em]">{title}</h1>
        {description && <p className="text-sm text-ink-500 mt-1 max-w-2xl leading-relaxed">{description}</p>}
        {meta && <div className="flex flex-wrap items-center gap-2 mt-3">{meta}</div>}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}
