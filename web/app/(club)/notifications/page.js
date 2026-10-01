"use client";

/**
 * Club notifications. The Secretary broadcasts a message; every member of the
 * club sees it here, regardless of role.
 */

import { useEffect, useState, useCallback } from "react";
import { AlertCircle, Bell, Plus } from "lucide-react";
import { PageHeader } from "@/components/shell/ClubShell";
import Button from "@/components/ui/Button";
import { Input, Textarea, Field } from "@/components/ui/Input";
import { Card, Alert, Loading, Empty } from "@/components/ui/States";
import { useSession } from "@/lib/session";
import { notifications as api, ApiError } from "@/lib/api";
import { relative, fmtDateTime } from "@/lib/format";

export default function NotificationsPage() {
  const { can } = useSession();
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const [sending, setSending] = useState(false);

  const load = useCallback(async (signal) => {
    try {
      const { notifications } = await api.list({ signal });
      setItems(notifications);
      setError(null);
    } catch (err) {
      if (err.name === "AbortError") return;
      setError(err instanceof ApiError ? err.message : "Could not load notifications.");
    }
  }, []);

  useEffect(() => {
    const c = new AbortController();
    load(c.signal);
    return () => c.abort();
  }, [load]);

  async function send(details) {
    await api.send(details);
    await load();
  }

  if (error && !items) {
    return <Alert tone="exception" icon={AlertCircle} title="Could not load notifications">{error}</Alert>;
  }
  if (!items) return <Loading label="Loading notifications" />;

  return (
    <>
      <PageHeader
        title="Notifications"
        description="Messages the Secretary has sent to everyone in this club."
        action={
          can("notification.send") && (
            <Button onClick={() => setSending(true)}>
              <Plus size={14} aria-hidden /> Send a notification
            </Button>
          )
        }
      />

      {error && <Alert tone="exception" icon={AlertCircle} className="mb-5">{error}</Alert>}

      {items.length === 0 ? (
        <Card><Empty icon={Bell} title="No notifications yet" /></Card>
      ) : (
        <ul className="space-y-2">
          {items.map((n) => (
            <li key={n.notificationId}>
              <Card className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <p className="text-[14px] font-medium text-ink-900">{n.title}</p>
                  <p className="text-[12px] text-ink-500 shrink-0" title={fmtDateTime(n.createdAt)}>
                    {relative(n.createdAt)}
                  </p>
                </div>
                <p className="mt-1.5 text-[13.5px] text-ink-700 leading-relaxed whitespace-pre-wrap">{n.message}</p>
                <p className="mt-2 text-[12px] text-ink-500">Sent by {n.sentBy}</p>
              </Card>
            </li>
          ))}
        </ul>
      )}

      {sending && (
        <SendNotificationDialog onClose={() => setSending(false)} onSubmit={send} />
      )}
    </>
  );
}

function SendNotificationDialog({ onClose, onSubmit }) {
  const [title, setTitle] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      await onSubmit({ title, message });
      onClose();
    } catch (err) {
      setError(err.message);
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy-950/40 p-5" role="dialog" aria-modal="true" aria-label="Send a notification">
      <Card className="w-full max-w-md p-5 shadow-pop animate-slideUp">
        <h2 className="text-sm font-semibold text-ink-900">Send a notification</h2>
        <p className="mt-1.5 text-[13px] text-ink-500 leading-relaxed">
          Every member of this club will see this message.
        </p>

        <div className="mt-4 space-y-4">
          <Field label="Title" htmlFor="title" required>
            <Input id="title" value={title} onChange={(e) => setTitle(e.target.value)} autoFocus />
          </Field>
          <Field label="Message" htmlFor="message" required>
            <Textarea id="message" value={message} onChange={(e) => setMessage(e.target.value)} rows={5} />
          </Field>
        </div>

        {error && <Alert tone="exception" icon={AlertCircle} className="mt-3">{error}</Alert>}

        <div className="mt-5 flex gap-2 justify-end">
          <Button variant="secondary" onClick={onClose} disabled={busy}>Never mind</Button>
          <Button onClick={submit} loading={busy} disabled={!title.trim() || !message.trim()}>Send</Button>
        </div>
      </Card>
    </div>
  );
}
