"use client";

import Link from "next/link";
import { BookLock, ShieldCheck, Users2, ScrollText, ArrowRight, FlaskConical } from "lucide-react";
import Button from "@/components/ui/Button";

const PILLARS = [
  {
    icon: BookLock,
    title: "An append-only ledger",
    body: "Every contribution, penalty and payout is appended and never amended. A capture error is corrected by a reversing entry, so the mistake and its correction both stay visible. The record cannot be quietly rewritten by anyone, including the chairperson."
  },
  {
    icon: ScrollText,
    title: "The constitution, enforced",
    body: "Each club's rules are captured as configuration and applied automatically: payout order, penalties, grace periods, quorum, waiting periods. The rules in force on the day of a transaction govern that transaction, and an amendment never recomputes a closed cycle."
  },
  {
    icon: ShieldCheck,
    title: "Two signatures on every payout",
    body: "A payout is initiated by the treasurer and approved by a different officer, with the eligibility assessment shown at the point of approval. No single person can move money out of the pool."
  },
  {
    icon: Users2,
    title: "Every member can see for themselves",
    body: "Members check their own balance, their position in the queue and the club's pool without asking an officer. The information gap that makes disputes possible simply closes."
  }
];

export default function Landing() {
  return (
    <div className="min-h-screen bg-navy-950 text-white">
      <header className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between on-navy">
        <div className="flex items-center gap-2.5">
          <span className="w-7 h-7 rounded-md bg-accent-600 grid place-items-center">
            <BookLock size={15} aria-hidden />
          </span>
          <span className="text-[14px] font-semibold tracking-tight">Stokvel Administration System</span>
        </div>
        <Button as={Link} href="/login" variant="onNavy" size="sm">Sign in</Button>
      </header>

      <main className="max-w-6xl mx-auto px-5 sm:px-8">
        <section className="pt-14 pb-16 sm:pt-24 sm:pb-24 max-w-3xl">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[12px] text-white/70 mb-6">
            <FlaskConical size={11} aria-hidden /> Interactive prototype · SCSC082 Group 5
          </span>
          <h1 className="text-[34px] sm:text-[52px] leading-[1.08] font-semibold tracking-[-0.02em]">
            The exercise book, the cash tin and the trust it all rests on.
          </h1>
          <p className="mt-6 text-[16px] sm:text-[18px] leading-relaxed text-white/65 max-w-2xl">
            South African savings clubs run on paper and goodwill. When the treasurer resigns, the records go
            with them. This system keeps each club's constitution as rules a computer enforces, and every cent
            in a ledger nobody can edit.
          </p>
          <p className="mt-4 text-[14px] text-white/45 max-w-2xl">
            It records money. It does not hold it, move it or settle it. Banking stays where the club already
            keeps it.
          </p>
          <div className="mt-9 flex flex-col sm:flex-row gap-3">
            <Button as={Link} href="/login" size="lg">
              Open the prototype <ArrowRight size={16} />
            </Button>
            <Button as={Link} href="/login" variant="onNavy" size="lg">See the demo walkthrough</Button>
          </div>
        </section>

        <section className="grid sm:grid-cols-2 gap-px bg-white/[0.08] rounded-xl overflow-hidden border border-white/[0.08]">
          {PILLARS.map((p) => (
            <div key={p.title} className="bg-navy-950 p-6 sm:p-8">
              <span className="w-9 h-9 rounded-lg bg-white/[0.07] grid place-items-center mb-4">
                <p.icon size={17} className="text-accent-600" aria-hidden />
              </span>
              <h2 className="text-[15px] font-semibold">{p.title}</h2>
              <p className="mt-2 text-[14px] leading-relaxed text-white/60">{p.body}</p>
            </div>
          ))}
        </section>

        <section className="py-16 sm:py-24 grid sm:grid-cols-3 gap-8">
          {[
            ["Rotating", "One member receives the whole pool each cycle, in an agreed order that cannot be jumped."],
            ["Accumulating", "The pool is held for the year and distributed at year-end, and the shares must sum exactly."],
            ["Burial society", "A benefit is paid when a covered dependant dies, once standing, cover and the waiting period all check out."]
          ].map(([k, v]) => (
            <div key={k}>
              <p className="text-[13px] font-semibold text-accent-600 uppercase tracking-wide">{k}</p>
              <p className="mt-2 text-[14px] leading-relaxed text-white/60">{v}</p>
            </div>
          ))}
        </section>
      </main>

      <footer className="border-t border-white/[0.08]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-6 text-[12px] text-white/40 flex flex-col sm:flex-row gap-2 sm:justify-between">
          <p>Group 5 · Department of Computer Science · University of Limpopo</p>
          <p>Prototype. Mock data throughout. No real money, accounts or personal information.</p>
        </div>
      </footer>
    </div>
  );
}
