"use client";

import { cx } from "@/lib/format";

export function Input({ className, invalid, ...rest }) {
  return (
    <input
      aria-invalid={invalid || undefined}
      className={cx(
        "w-full h-11 rounded border bg-surface px-3 text-[15px] text-ink-900",
        "placeholder:text-ink-400 transition-colors duration-150",
        "disabled:bg-canvas disabled:text-ink-400",
        invalid ? "border-exc-600" : "border-line-strong hover:border-ink-400",
        className
      )}
      {...rest}
    />
  );
}

export function Select({ className, children, invalid, ...rest }) {
  return (
    <select
      aria-invalid={invalid || undefined}
      className={cx(
        "w-full h-11 rounded border bg-surface px-3 text-[15px] text-ink-900 appearance-none",
        "bg-[url('data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 fill=%22none%22 stroke=%22%23667085%22 stroke-width=%222%22><path d=%22M4 6l4 4 4-4%22/></svg>')] bg-no-repeat bg-[right_0.75rem_center]",
        invalid ? "border-exc-600" : "border-line-strong hover:border-ink-400",
        className
      )}
      {...rest}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...rest }) {
  return (
    <textarea
      className={cx(
        "w-full rounded border border-line-strong bg-surface px-3 py-2.5 text-[15px]",
        "text-ink-900 placeholder:text-ink-400 min-h-[84px]",
        className
      )}
      {...rest}
    />
  );
}

/**
 * Label, control, and one of hint or error beneath it.
 *
 * The error replaces the hint rather than appearing alongside it — two lines of
 * small grey text under a field is how a person misses the one that matters.
 */
export function Field({ label, hint, error, required, htmlFor, children, className }) {
  const describedBy = error ? `${htmlFor}-error` : hint ? `${htmlFor}-hint` : undefined;

  return (
    <div className={cx("space-y-1.5", className)}>
      {label && (
        <label htmlFor={htmlFor} className="block text-[13px] font-medium text-ink-700">
          {label}
          {required && (
            <>
              <span className="text-exc-600 ml-0.5" aria-hidden>
                *
              </span>
              <span className="sr-only"> (required)</span>
            </>
          )}
        </label>
      )}

      {children}

      {error ? (
        <p id={`${htmlFor}-error`} className="text-[12px] text-exc-600">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-[12px] text-ink-500">
          {hint}
        </p>
      ) : null}

      {describedBy && <span className="hidden" />}
    </div>
  );
}