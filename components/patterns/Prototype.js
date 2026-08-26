import { FlaskConical } from "lucide-react";
import { cx } from "@/lib/format";

/** Marks behaviour that is simulated. Honesty about what is and is not real. */
export default function PrototypeNote({ children, className, inline }) {
  if (inline) {
    return (
      <span className={cx("inline-flex items-center gap-1 text-[11px] font-medium text-warn-700 bg-warn-50 border border-warn-600/25 rounded px-1.5 py-0.5", className)}>
        <FlaskConical size={10} aria-hidden /> {children}
      </span>
    );
  }
  return (
    <div className={cx("flex items-start gap-2.5 rounded-lg border border-dashed border-warn-600/35 bg-warn-50/60 px-3.5 py-2.5", className)}>
      <FlaskConical size={14} className="text-warn-700 shrink-0 mt-0.5" aria-hidden />
      <p className="text-[12px] text-warn-700 leading-relaxed"><span className="font-semibold">Prototype behaviour. </span>{children}</p>
    </div>
  );
}
