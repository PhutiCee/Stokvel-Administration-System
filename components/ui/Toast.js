"use client";
import { createContext, useCallback, useContext, useState } from "react";
import { CheckCircle2, AlertTriangle, XCircle, Info, X } from "lucide-react";
import { cx } from "@/lib/format";

const ToastCtx = createContext(null);
const ICONS = { success: CheckCircle2, error: XCircle, warning: AlertTriangle, info: Info };
const TONES = {
  success: "border-pos-600/30 bg-pos-50 text-pos-700",
  error: "border-exc-600/30 bg-exc-50 text-exc-700",
  warning: "border-warn-600/30 bg-warn-50 text-warn-700",
  info: "border-line-strong bg-surface text-ink-900"
};

export function ToastProvider({ children }) {
  const [items, setItems] = useState([]);
  const push = useCallback((toast) => {
    const id = Math.random().toString(36).slice(2);
    setItems((s) => [...s, { id, tone: "success", ...toast }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), toast.duration || 5000);
  }, []);
  const dismiss = (id) => setItems((s) => s.filter((t) => t.id !== id));

  return (
    <ToastCtx.Provider value={{ push }}>
      {children}
      <div className="fixed z-[60] bottom-4 left-4 right-4 sm:left-auto sm:right-6 sm:w-[380px] flex flex-col gap-2 no-print" role="status" aria-live="polite">
        {items.map((t) => {
          const Icon = ICONS[t.tone] || Info;
          return (
            <div key={t.id} className={cx("flex items-start gap-3 rounded-lg border shadow-pop px-4 py-3 animate-slideUp", TONES[t.tone])}>
              <Icon size={17} className="shrink-0 mt-0.5" aria-hidden />
              <div className="min-w-0 flex-1">
                <p className="text-[13px] font-semibold">{t.title}</p>
                {t.description && <p className="text-[13px] opacity-90 mt-0.5">{t.description}</p>}
              </div>
              <button onClick={() => dismiss(t.id)} aria-label="Dismiss" className="opacity-60 hover:opacity-100"><X size={15} /></button>
            </div>
          );
        })}
      </div>
    </ToastCtx.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastCtx);
  return ctx || { push: () => {} };
}
