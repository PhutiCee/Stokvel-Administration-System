"use client";
import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import { useSession } from "@/lib/session";
import { fmtDateTime } from "@/lib/format";
import { PageHeader } from "@/components/shell/ClubShell";
import { Action, Feedback, fieldClass } from "@/components/ui/Workflow";
export default function Announcements() {
  const { can } = useSession();
  const [data, setData] = useState(null),
    [offset, setOffset] = useState(0),
    [error, setError] = useState(""),
    [message, setMessage] = useState(""),
    [busy, setBusy] = useState(false),
    [subject, setSubject] = useState(""),
    [body, setBody] = useState(""),
    [original, setOriginal] = useState(null);
  const load = async (page = offset) =>
    setData(await api.get("/api/announcements?offset=" + page));
  useEffect(() => {
    const c = new AbortController();
    setData(null);
    api
      .get("/api/announcements?offset=" + offset, { signal: c.signal })
      .then(setData)
      .catch((e) => {
        if (e.name !== "AbortError") setError(e.message);
      });
    return () => c.abort();
  }, [offset]);
  async function publish(e) {
    e.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await api.post("/api/announcements", {
        subject,
        body,
        correctsId: original?.announcement_id,
      });
      setSubject("");
      setBody("");
      setOriginal(null);
      await load(0);
      setOffset(0);
      setMessage(
        "Announcement published. It is now part of the permanent record.",
      );
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <>
      <PageHeader
        title="Announcements"
        description="Club notices, newest first. Corrections remain linked to the original notice."
      />
      <Feedback error={error} message={message} />
      {can("announcement.publish") && (
        <form
          onSubmit={publish}
          className="p-4 mb-6 border border-line rounded"
        >
          <fieldset disabled={busy}>
            <h2>
              {original
                ? "Correction to: " + original.subject
                : "Publish an announcement"}
            </h2>
            <p className="text-sm my-2">
              Published notices cannot be edited or deleted.
            </p>
            <label>
              Subject
              <input
                required
                maxLength={160}
                className={fieldClass}
                value={subject}
                onChange={(e) => setSubject(e.target.value)}
              />
            </label>
            <label>
              Body
              <textarea
                required
                maxLength={10000}
                rows={5}
                className={fieldClass}
                value={body}
                onChange={(e) => setBody(e.target.value)}
              />
            </label>
            <Action type="submit">{busy ? "Publishing…" : "Publish"}</Action>
            {original && (
              <Action type="button" onClick={() => setOriginal(null)}>
                Cancel correction
              </Action>
            )}
          </fieldset>
        </form>
      )}
      {data?.announcements.map((a) => (
        <article
          key={a.announcement_id}
          className="border border-line rounded p-4 mb-4"
        >
          <h2 className="font-semibold">{a.subject}</h2>
          <p className="text-sm my-2">
            {a.author_name} · {fmtDateTime(a.published_at)}
          </p>
          <p className="whitespace-pre-wrap">{a.body}</p>
          {a.original && (
            <details className="my-3">
              <summary>Corrects: {a.original.subject}</summary>
              <p className="whitespace-pre-wrap">{a.original.body}</p>
            </details>
          )}
          {a.corrections.map((c) => (
            <div key={c.announcement_id} className="border-l-4 pl-3 my-3">
              <strong>Correction: {c.subject}</strong>
              <p>{fmtDateTime(c.published_at)}</p>
              <p className="whitespace-pre-wrap">{c.body}</p>
            </div>
          ))}
          {can("announcement.publish") && (
            <Action
              disabled={busy}
              onClick={() => {
                setOriginal(a);
                setSubject("Correction: " + a.subject);
                setBody("");
                window.scrollTo({ top: 0, behavior: "smooth" });
              }}
            >
              Write correction
            </Action>
          )}
        </article>
      ))}
      {data?.announcements.length === 0 && <p>No announcements yet.</p>}
      {!data && !error && <p>Loading announcements…</p>}
      <Action
        disabled={offset === 0 || busy}
        onClick={() => setOffset(Math.max(0, offset - 20))}
      >
        Newer
      </Action>
      <Action
        disabled={!data?.hasMore || busy}
        onClick={() => setOffset(offset + 20)}
      >
        Older
      </Action>
    </>
  );
}
