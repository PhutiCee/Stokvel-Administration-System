import Link from "next/link";
import Wordmark from "@/components/Wordmark";
import Button from "@/components/ui/Button";
import { ShieldCheck, Scale, Users, ArrowLeftRight } from "lucide-react";

export const metadata = {
  title: "The book of account for your savings club",
  description:
    "Contributions, payouts and members for rotating savings clubs, grocery stokvels and burial societies."
};

/**
 * A worked extract from a real ledger.
 *
 * This is the hero, in place of the usual headline statistic, because the book
 * is the thing this system replaces and the thing every member already
 * understands. The rows are chosen to show a CORRECTION: a contribution
 * captured twice, then reversed. Both rows remain. A member reading this learns
 * the central promise of the product before they have read a word of copy.
 */
function LedgerExtract() {
  const rows = [
    { date: "2 Sep", type: "Contribution", who: "Naledi Mabaso", amount: "+R500.00", balance: "3 900.00" },
    { date: "4 Sep", type: "Contribution", who: "Sipho Nkuna", amount: "+R500.00", balance: "4 400.00" },
    { date: "5 Sep", type: "Contribution", who: "Dineo Rakgoale", amount: "+R500.00", balance: "4 900.00", flagged: true },
    { date: "5 Sep", type: "Reversal", who: "Dineo Rakgoale", amount: "\u2212R500.00", balance: "4 400.00", reversal: true,
      note: "Captured twice in error" },
    { date: "6 Sep", type: "Penalty", who: "Lerato Ndlovu", amount: "+R50.00", balance: "4 450.00" }
  ];

  return (
    <figure className="m-0">
      <div className="bg-surface border border-line rounded-lg shadow-card overflow-hidden">
        <div className="px-4 sm:px-5 py-3.5 border-b border-line flex items-baseline justify-between gap-3">
          <h2 className="text-[13px] font-semibold text-ink-900">Mmakau Rotating Savings Club</h2>
          <span className="text-[12px] text-ink-500">Cycle 12</span>
        </div>

        <table className="w-full text-[13px] border-collapse">
          <caption className="sr-only">
            An extract from a club ledger showing a duplicate contribution corrected by a reversing entry
          </caption>
          <thead>
            <tr className="bg-canvas/70 border-b border-line text-ink-500">
              <th scope="col" className="text-left font-medium px-4 sm:px-5 py-2">Date</th>
              <th scope="col" className="text-left font-medium py-2">Entry</th>
              <th scope="col" className="text-right font-medium py-2">Amount</th>
              <th scope="col" className="text-right font-medium px-4 sm:px-5 py-2">Balance</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, i) => (
              <tr
                key={i}
                className={`border-b border-line last:border-0 ${r.reversal ? "bg-exc-50/40" : ""}`}
              >
                <td className="px-4 sm:px-5 py-2.5 text-ink-500 whitespace-nowrap font-mono tnum">
                  {r.date}
                </td>
                <td className="py-2.5 pr-3">
                  <span className="block text-ink-900">{r.who}</span>
                  <span className={`block text-[12px] ${r.reversal ? "text-exc-700" : "text-ink-500"}`}>
                    {r.note || r.type}
                  </span>
                </td>
                <td
                  className={`py-2.5 text-right font-mono tnum whitespace-nowrap ${
                    r.reversal ? "text-exc-700" : "text-ink-900"
                  }`}
                >
                  {r.amount}
                </td>
                <td className="px-4 sm:px-5 py-2.5 text-right font-mono tnum text-ink-500 whitespace-nowrap">
                  {r.balance}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <figcaption className="mt-3 text-[13px] text-ink-500 leading-relaxed">
        Dineo&rsquo;s contribution was captured twice. The correction is the fourth line, not a
        deletion of the third. Both stay in the book, and the balance is right again.
      </figcaption>
    </figure>
  );
}

const CLUB_KINDS = [
  {
    name: "Rotating savings clubs",
    body:
      "Everyone pays the same amount each month and one member takes the whole pool, in turn, until the rotation is complete. The system keeps the queue, refuses a payout to anyone who is not next, and shows each member the month their turn falls."
  },
  {
    name: "Grocery and Christmas stokvels",
    body:
      "Money accumulates through the year and is shared out at the end of it. The share each member receives is worked out from what they actually paid in, including anyone who joined part-way through."
  },
  {
    name: "Burial societies",
    body:
      "Contributions buy cover for a member and their registered dependants. When a claim is lodged, it is assessed against the benefit table and the waiting period that applied on the date of death — not the rules as they stand today."
  }
];

const SAFEGUARDS = [
  {
    icon: ShieldCheck,
    title: "Nothing is deleted",
    body:
      "Entries cannot be edited or removed, by anyone, including whoever runs the system. A mistake is corrected by a second entry that reverses the first, and both remain visible with the reason recorded."
  },
  {
    icon: ArrowLeftRight,
    title: "No one pays money out alone",
    body:
      "A payout is initiated by the treasurer and approved by the chairperson. The same person cannot do both, and the system refuses the attempt rather than relying on anyone to remember the rule."
  },
  {
    icon: Scale,
    title: "The book is checked against the bank",
    body:
      "The treasurer records the bank balance and the system shows the difference. Any gap is raised as an exception on the dashboard until somebody explains it."
  },
  {
    icon: Users,
    title: "Members see their own record",
    body:
      "Every member can open their statement and see every contribution, penalty and payout against their name, without having to ask the treasurer for the book."
  }
];

export default function HomePage() {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b border-line bg-surface">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 h-16 flex items-center justify-between gap-4">
          <Wordmark href="/" />
          <Button as={Link} href="/login" size="sm">
            Sign in
          </Button>
        </div>
      </header>

      <main className="flex-1">
        {/* Hero */}
        <section className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-20">
          <div className="grid lg:grid-cols-[minmax(0,1fr)_minmax(0,1.05fr)] gap-12 lg:gap-16 items-center">
            <div>
              <h1 className="text-[32px] sm:text-[40px] leading-[1.12] font-semibold tracking-[-0.02em] text-ink-900">
                The book of account for your savings club
              </h1>

              <p className="mt-5 text-[17px] leading-relaxed text-ink-700 max-w-[52ch]">
                Every rand in and every rand out, recorded in one book that cannot be quietly
                edited. Built for rotating savings clubs, grocery stokvels and burial societies,
                each running on its own rules.
              </p>

              <div className="mt-8 flex flex-wrap items-center gap-3">
                <Button as={Link} href="/login" size="lg">
                  Sign in
                </Button>
                <p className="text-[13px] text-ink-500">
                  Your secretary registers you and gives you your details.
                </p>
              </div>
            </div>

            <LedgerExtract />
          </div>
        </section>

        {/* The three kinds of club */}
        <section className="border-t border-line bg-surface">
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-18">
            <h2 className="text-[22px] font-semibold tracking-[-0.01em] text-ink-900">
              Three kinds of club, three sets of rules
            </h2>
            <p className="mt-2.5 text-[15px] text-ink-700 max-w-[62ch] leading-relaxed">
              A club&rsquo;s constitution is captured when it is set up — the contribution, the
              penalty, the grace period, the quorum — and the system works to those figures. No two
              clubs have to be run the same way.
            </p>

            <dl className="mt-10 grid md:grid-cols-3 gap-x-10 gap-y-8">
              {CLUB_KINDS.map((k) => (
                <div key={k.name} className="border-t-2 border-navy-950 pt-4">
                  <dt className="text-[15px] font-semibold text-ink-900">{k.name}</dt>
                  <dd className="mt-2 text-[14px] leading-relaxed text-ink-700">{k.body}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* Safeguards */}
        <section className="bg-navy-950 text-white on-navy">
          <div className="max-w-6xl mx-auto px-5 sm:px-8 py-14 sm:py-18">
            <h2 className="text-[22px] font-semibold tracking-[-0.01em]">
              Where the money is concerned, the system does not take anyone&rsquo;s word for it
            </h2>
            <p className="mt-2.5 text-[15px] text-white/60 max-w-[62ch] leading-relaxed">
              A stokvel runs on trust, and the fastest way to lose it is a book only one person can
              see. These four rules are enforced by the system, not by agreement.
            </p>

            <div className="mt-10 grid sm:grid-cols-2 gap-x-10 gap-y-9">
              {SAFEGUARDS.map((s) => (
                <div key={s.title} className="flex gap-4">
                  <span className="shrink-0 grid place-items-center w-9 h-9 rounded-md bg-white/10 text-white/80">
                    <s.icon size={17} aria-hidden />
                  </span>
                  <div className="min-w-0">
                    <h3 className="text-[15px] font-semibold">{s.title}</h3>
                    <p className="mt-1.5 text-[14px] leading-relaxed text-white/60">{s.body}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line bg-surface">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 py-8 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <p className="text-[13px] text-ink-500">
            Group 5 &middot; SCSC082 Software Engineering &middot; Department of Computer Science,
            University of Limpopo
          </p>
          <Link href="/login" className="text-[13px] font-medium text-accent-600 hover:text-accent-700 w-fit rounded">
            Sign in
          </Link>
        </div>
      </footer>
    </div>
  );
}