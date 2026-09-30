"use client";
import { useEffect, useState } from "react";
import { contributions as api } from "@/lib/api";
import { isZeroAmount, fmtDate } from "@/lib/format";
import Button from "@/components/ui/Button";
import { Input, Field } from "@/components/ui/Input";
import { Card, Alert, Loading } from "@/components/ui/States";
import ConfirmDialog from "@/components/ui/ConfirmDialog";

export default function ProofPanel({ contribution, canUpload, onClose }) {
  const id = contribution.contributionId;
  const [proof, setProof] = useState(null),
    [url, setUrl] = useState(null);
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false),
    [file, setFile] = useState(null);
  const [revision, setRevision] = useState(0),
    [confirm, setConfirm] = useState(null);
  const [notice, setNotice] = useState("");
  useEffect(() => {
    const c = new AbortController();
    let objectUrl;
    setLoading(true);
    setUrl(null);
    setError("");
    (async () => {
      try {
        const result = await api.proof(id, { signal: c.signal });
        if (c.signal.aborted) return;
        setProof(result.proof);
        if (result.proof) {
          const blob = await api.proofFile(id, { signal: c.signal });
          if (c.signal.aborted) return;
          objectUrl = URL.createObjectURL(blob);
          setUrl(objectUrl);
        }
      } catch (err) {
        if (!c.signal.aborted) setError(err.message);
      } finally {
        if (!c.signal.aborted) setLoading(false);
      }
    })();
    return () => {
      c.abort();
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [id, revision]);

  async function save() {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await api.uploadProof(id, file);
      setFile(null);
      setRevision((v) => v + 1);
      setNotice("Proof of payment saved.");
    } finally {
      setBusy(false);
    }
  }
  async function submit(e) {
    e.preventDefault();
    setError("");
    if (!file || !file.size)
      return setError("Choose a non-empty JPEG, PNG or PDF.");
    if (!["image/jpeg", "image/png", "application/pdf"].includes(file.type))
      return setError("Choose a JPEG, PNG or PDF.");
    if (file.size > 5 * 1024 * 1024)
      return setError("The file must be no larger than 5 MB.");
    if (proof) return setConfirm("replace");
    try {
      await save();
    } catch (err) {
      setError(err.message);
    }
  }
  return (
    <Card className="p-5 mt-5">
      <div className="flex items-start justify-between gap-3">
        <h2 className="font-semibold">
          Proof of payment · {contribution.fullName}
        </h2>
        <Button
          size="sm"
          variant="ghost"
          onClick={onClose}
          disabled={busy || !!confirm}
        >
          Close
        </Button>
      </div>
      {loading && <Loading label="Loading proof" />}
      {error && (
        <Alert tone="exception" className="mt-3">
          {error}
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setRevision((v) => v + 1)}
          >
            Retry
          </Button>
        </Alert>
      )}
      {notice && (
        <p role="status" className="mt-3 text-sm">
          {notice}
        </p>
      )}
      {!loading &&
        !error &&
        (proof ? (
          <div className="mt-3 text-sm space-y-2">
            <p className="break-all">
              {proof.filename} · {Math.ceil(proof.fileSize / 1024)} KB ·{" "}
              {fmtDate(proof.uploadedAt)}
            </p>
            {url && (
              <div className="flex flex-wrap gap-4">
                <a
                  className="underline"
                  href={url}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  View proof
                </a>
                <a className="underline" href={url} download={proof.filename}>
                  Download proof
                </a>
              </div>
            )}
            {canUpload && (
              <Button
                size="sm"
                variant="danger"
                onClick={() => setConfirm("remove")}
                disabled={busy}
              >
                Remove proof
              </Button>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm text-ink-500">No proof is attached.</p>
        ))}
      {canUpload && !isZeroAmount(contribution.captured) && (
        <form onSubmit={submit} className="mt-4 space-y-3">
          <Field
            label={proof ? "Replacement file" : "Proof file"}
            htmlFor="proof-file"
            hint="JPEG, PNG or PDF, up to 5 MB. One file per contribution."
          >
            <Input
              key={revision}
              id="proof-file"
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              disabled={busy || loading}
              onChange={(e) => setFile(e.target.files?.[0] || null)}
            />
          </Field>
          <Button type="submit" loading={busy} disabled={loading || !file}>
            {proof ? "Replace proof" : "Upload proof"}
          </Button>
        </form>
      )}
      {canUpload && isZeroAmount(contribution.captured) && (
        <p className="mt-3 text-sm">
          Capture a contribution before attaching proof.
        </p>
      )}
      {confirm && (
        <ConfirmDialog
          title={
            confirm === "remove"
              ? "Remove proof of payment"
              : "Replace proof of payment"
          }
          description="This changes the attached evidence. It does not change the contribution or ledger."
          requireReason={false}
          onClose={() => setConfirm(null)}
          onConfirm={async () => {
            if (confirm === "replace") await save();
            else {
              await api.removeProof(id);
              setNotice("Proof removed.");
              setRevision((v) => v + 1);
            }
          }}
        />
      )}
    </Card>
  );
}
