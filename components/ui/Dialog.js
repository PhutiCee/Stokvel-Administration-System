"use client";
import { useEffect, useRef } from "react";
import { X } from "lucide-react";
import { cx } from "@/lib/format";

export default function Dialog({ open, onClose, title, description, children, footer, size = "md" }) {
  const ref = useRef(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const t = setTimeout(() => ref.current?.querySelector("[data-autofocus],button,input,select,textarea")?.focus(), 30);
    return () => { document.removeEventListener("keydown", onKey); document.body.style.overflow = prev; clearTimeout(t); };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center">
      <div className="absolute inset-0 bg-navy-950/50 backdrop-blur-[2px]" onClick={onClose} aria-hidden />
      <div
        ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={cx(
          "relative bg-surface w-full rounded-t-xl sm:rounded-xl shadow-pop animate-slideUp",
          "max-h-[92vh] flex flex-col",
          size === "lg" ? "sm:max-w-2xl" : size === "xl" ? "sm:max-w-4xl" : "sm:max-w-md"
        )}
      >
        <div className="flex items-start justify-between gap-4 px-5 py-4 border-b border-line">
          <div>
            <h2 className="text-[15px] font-semibold text-ink-900">{title}</h2>
            {description && <p className="text-[13px] text-ink-500 mt-0.5">{description}</p>}
          </div>
          <button onClick={onClose} aria-label="Close" className="text-ink-500 hover:text-ink-900 rounded p-1 -m-1 transition-colors">
            <X size={18} />
          </button>
        </div>
        <div className="px-5 py-4 overflow-y-auto">{children}</div>
        {footer && <div className="px-5 py-4 border-t border-line bg-canvas/60 rounded-b-xl flex flex-col-reverse sm:flex-row sm:justify-end gap-2">{footer}</div>}
      </div>
    </div>
  );
}
