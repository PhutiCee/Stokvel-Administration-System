import Link from "next/link";
import { FileQuestion } from "lucide-react";

/**
 * BR-9 / REQ-14: a request for a record belonging to another club must be
 * indistinguishable from a request for a record that does not exist. That is why
 * this page says "not found" and never "not permitted", and why it discloses
 * nothing about what might exist elsewhere.
 */
export default function NotFound() {
  return (
    <div className="min-h-screen grid place-items-center px-6 bg-canvas">
      <div className="text-center max-w-sm">
        <div className="w-11 h-11 rounded-full bg-surface border border-line grid place-items-center mx-auto mb-4">
          <FileQuestion size={19} className="text-ink-400" aria-hidden />
        </div>
        <h1 className="text-lg font-semibold">We could not find that</h1>
        <p className="text-sm text-ink-500 mt-2 leading-relaxed">
          The page or record does not exist, or it is not part of the club you are working in.
        </p>
        <Link href="/dashboard" className="inline-block mt-5 text-sm font-medium text-accent-600 hover:text-accent-700">
          Back to the dashboard
        </Link>
      </div>
    </div>
  );
}
