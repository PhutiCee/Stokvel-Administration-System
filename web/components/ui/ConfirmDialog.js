"use client";

/**
 * A modal that asks for confirmation before an irreversible or consequential
 * action, optionally with a reason (REQ-70 and similar: every cancellation is
 * recorded with why).
 *
 * The same shape as platform/page.js's SuspendDialog, lifted out so every
 * payout, queue, distribution and claim screen shares one implementation
 * rather than five slightly different copies of it.
 */

import { useState } from "react";
import { AlertCircle } from "lucide-react";
import Button from "@/components/ui/Button";
import { Textarea, Field } from "@/components/ui/Input";
import { Card, Alert } from "@/components/ui/States";

export default function ConfirmDialog({
  title,
  description,
  reasonLabel = "Reason",
  reasonHint = "Recorded in the audit log.",
  requireReason = true,
  confirmLabel = "Confirm",
  confirmVariant = "danger",
  onClose,
  onConfirm
}) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason);
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-5"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <Card className="w-full max-w-md p-5 shadow-pop animate-slideUp">
        <h2 className="text-sm font-semibold text-ink-900">{title}</h2>
        {description && <p className="mt-1.5 text-[13px] text-ink-500 leading-relaxed">{description}</p>}

        {requireReason && (
          <div className="mt-4">
            <Field label={reasonLabel} htmlFor="reason" required hint={reasonHint}>
              <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
            </Field>
          </div>
        )}

        {error && <Alert tone="exception" icon={AlertCircle} className="mt-3">{error}</Alert>}

        <div className="mt-5 flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Never mind</Button>
          <Button variant={confirmVariant} onClick={submit} loading={busy}>{confirmLabel}</Button>
        </div>
      </Card>
    </div>
  );
}