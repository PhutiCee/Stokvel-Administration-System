import Link from "next/link";
import Button from "@/components/ui/Button";
import Wordmark from "@/components/Wordmark";

export default function NotFound() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-surface">
        <div className="max-w-3xl mx-auto px-5 sm:px-8 h-16 flex items-center">
          <Wordmark href="/" />
        </div>
      </header>
      <main className="flex-1 grid place-items-center px-5 py-20">
        <div className="text-center max-w-sm">
          <h1 className="text-[22px] font-semibold tracking-[-0.01em]">This page does not exist</h1>
          <p className="mt-2.5 text-[14px] text-ink-500 leading-relaxed">
            The link may be out of date, or the record may belong to a club you are not in.
          </p>
          <Button as={Link} href="/" className="mt-6">
            Back to the start
          </Button>
        </div>
      </main>
    </div>
  );
}