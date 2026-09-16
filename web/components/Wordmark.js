import Link from "next/link";
import { cx } from "@/lib/format";

/**
 * The wordmark.
 *
 * The mark is a stack of three horizontal rules — the ruled lines of the
 * exercise book a stokvel treasurer has always kept the record in, which is the
 * thing this system replaces. The lines are unequal, as a part-written page is.
 */
export function Mark({ size = 28, className }) {
  return (
    <span
      className={cx("inline-grid place-items-center rounded-md bg-accent-600 text-white shrink-0", className)}
      style={{ width: size, height: size }}
      aria-hidden
    >
      <svg width={size * 0.54} height={size * 0.54} viewBox="0 0 16 16" fill="none">
        <path
          d="M3 4.5h10M3 8h10M3 11.5h6"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
        />
      </svg>
    </span>
  );
}

export default function Wordmark({ href = "/", size = 28, subdued = false, className }) {
  const content = (
    <>
      <Mark size={size} />
      <span
        className={cx(
          "font-semibold tracking-[-0.01em]",
          size >= 32 ? "text-[16px]" : "text-[14px]",
          subdued ? "text-white" : "text-ink-900"
        )}
      >
        Stokvel Administration System
      </span>
    </>
  );

  if (!href) {
    return <span className={cx("inline-flex items-center gap-2.5", className)}>{content}</span>;
  }

  return (
    <Link href={href} className={cx("inline-flex items-center gap-2.5 w-fit rounded", className)}>
      {content}
    </Link>
  );
}