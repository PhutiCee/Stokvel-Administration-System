# Stokvel Administration System — high-fidelity prototype

Interactive UI/UX prototype for the SCSC082 Software Engineering group project
(Group 5, Department of Computer Science, University of Limpopo), built from the
approved SRS v1.0 and the Detailed System Design Document.

**This is a prototype.** Every record is mock data held in memory. There is no
database, no real authentication, no server-side authorisation and no external
service. What it demonstrates is the product: the workflows, the rules, the
interface and the interaction quality, so the group and the client can approve or
change the design before the production system is built.

## Running it

```bash
npm install
npm run dev      # http://localhost:3000
```

Production build:

```bash
npm run build && npm start
```

## Deploying to Vercel

Push the repository to GitHub, import it at vercel.com, accept the defaults.
Next.js is detected automatically. There are no environment variables, no
database and no build configuration to set.

## The demonstration route

1. **Land on `/`** — the product explains itself before anyone signs in.
2. **Sign in as Nomsa Maluleke.** She is treasurer of one club and an ordinary
   member of another, using one account.
3. **Club selector** — role and outstanding position shown per club, so she can
   see which one needs her.
4. **Treasurer dashboard** — a reconciliation exception sits at the top, above
   the ordinary indicators.
5. **Contributions** — capture a partial payment and watch the status resolve.
   Capture more than the cycle needs and watch the excess cascade to penalties,
   then arrears, then credit.
6. **Payouts → queue** — initiate to somebody who is *not* at the head. The
   refusal names who is in fact next. Then initiate correctly.
7. **Approval** — open the pending payout while still signed in as Nomsa: the
   system refuses her own approval. Switch to Thabo with the amber demo control
   in the header and it goes through; the ledger moves and the queue advances.
8. **Ledger** — no edit or delete anywhere. Reverse an entry with a reason and
   watch both rows stay visible.
9. **Reconciliation** — clear the R450 difference with an explanatory entry.
10. **Switch club to Bokamoso** — the same account, now an ordinary member, with
    a different navigation and a member-shaped dashboard.
11. **Sign out, sign in as the Platform Administrator** — a different surface
    entirely, which cannot see inside any club.

Burial claims live in Lehumo Burial Society: two lodged claims, one payable and
one refused because the member is still inside the 180-day waiting period.

"Reset demo data" at the bottom of the sidebar returns everything to seed state.

## Structure

```
app/                 routes; (club) is the club-scoped shell
components/ui/       primitives: Button, Card, Dialog, Table, Toast, states
components/patterns/ domain patterns: Money, StatusBadge, PageHeader, chart
components/shell/    application shell and navigation
lib/rules/           the rules engine — pure, no React, no data access
lib/mock/seed.js     all mock data, generated relative to today
lib/store.js         in-memory store, persisted to localStorage
lib/data.js          the data access boundary every component reads through
docs/                traceability matrix and decision log
```

The rules engine and the data access boundary are the two pieces built to survive
into production unchanged. Everything above `lib/data.js` is written against
function signatures rather than against the mock, so swapping in PostgreSQL
replaces one file.

## What is deliberately not built

Meetings and resolutions, the defaulter pipeline detail, announcements
composition, year-end distribution, exit settlement, constitutional amendment and
the AI assistant are designed but out of scope here, in favour of finishing
sixteen screens properly. See `docs/decisions.md`.
