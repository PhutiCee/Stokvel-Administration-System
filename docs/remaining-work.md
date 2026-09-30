# Remaining work - Stokvel Administration System (Group 5, SCSC082)

Written 28 September 2026, from the SRS, `docs/traceability.md` and the code as it
stands. Code freeze is 29 September and the portfolio is due 1 October. Updated after
the governance implementation on 29 September: UC5 remains the missing use case;
UC7 is implemented below. Other members retain their existing assignments.

Every requirement below was checked against the actual code, not just against
`traceability.md`, which turned out to be incomplete (see section 6).

## 1. Where we are

| Use case | State |
|---|---|
| UC1 Authenticate, select club | Built |
| UC2 Contributions | Built, except batch capture (REQ-58) |
| UC3 Payouts (rotation, distribution) and the rotating queue | Built, backend and web pages |
| UC4 Burial claims and dependants | Built, backend and web pages |
| UC5 Reconciliation | **Not built** (table exists with one seeded row) |
| UC6 Assistant | Implementation added on `racha`; owned by another member, not audited in this governance change |
| UC7 Governance | **Built:** meetings, quorum, resolutions, amendments and resolution-based expulsion; see decision 36 |

Also built this sprint: constitution versioning (REQ-30 to REQ-33), penalty waiver
(REQ-63), proof-of-payment upload (REQ-53), officer-count caps (decision 34).
Tests: 258 automated tests pass with timezone-independent calendar rules,
plus `npm run test:governance`
for isolated database/HTTP checks. Imports resolve
(`npm run check`). Next free migration number: **019** (016–017 governance; 018 ledger reversals).

## 2. How to work on any task

- Each feature is a module in `server/src/modules/<name>/` with three files:
  `*.routes.js` (HTTP only), `*.service.js` (rules, no SQL), `*.repo.js` (SQL only).
  The repo never opens a transaction; the service does, with `withClubTransaction`.
- Club data is only reached through `forClub(clubId)`. It throws if a query touches a
  club-scoped table without a `club_id`. New club tables go in `TENANT_SCOPED_TABLES`
  in `server/src/db/pool.js`.
- Permissions: add the action to the role lists in `server/src/rules/permissions.js`
  and guard the route with `authorize("your.action")`. Do not invent another system.
- Money is integer cents inside the code (`lib/money.js`). Never use float maths.
- Anything that moves money goes through `ledger.service.js` -> `appendEntry()`.
  Ledger entries are never edited or deleted; corrections are reversing entries.
- Every service call takes an `audit` callback. Log successes and refusals.
- Pure decisions (is this allowed?) go in `server/src/rules/` with unit tests in
  `server/tests/` that need no database.
- Never edit a migration that has been applied. Add a new numbered one.
- Web: match the existing pages. Icons come straight from `lucide-react`, money is
  shown with `money()` from `lib/format.js`, shared pieces are in `components/ui/`
  (`Button`, `Input`, `States`, `ConfirmDialog`). Use `useSession().can("...")`.
  Palette and fonts are in `web/tailwind.config.js`; do not change it.
- Definition of done for every task: `npm test` and `npm run check` pass, the web
  builds (`npm run build`) if you touched `web/`, a row is added to
  `docs/traceability.md`, and any judgement call is written up in
  `Docs/Desicions.md`.
- Before you start, pull, and check nobody has used your migration number.

## 3. Priority 0 - do first (small, protects what is already built)

**T1. Make the database checks reproducible.** (M)
The 240-odd checks that prove the database-level behaviour (triggers, dual
authorisation, refusals) were run from scratch files outside the repo, so nobody else
can re-run them and a marker cannot see the evidence. Move them into
`server/integration/`, add `npm run test:integration` that rebuilds the database and
runs them. They are not repeatable on a used database, so the runner must rebuild
first.

**T2. Known defects — date/cycle items completed in migration 017.**
Calendar dates are selected as text, input dates are validated, and South African
calendar-day rules no longer depend on the host timezone. New cycles select the
constitution by commencement under REQ-33 and permanently pin that version.
Pre-existing cycles keep their former due-date selection; no historic money is
rewritten. Decisions 38 and the integration checks record this migration boundary.
Follow-on date fixes now preserve PostgreSQL DATE values as text, use South African
session/calendar dates and browser display, validate member/platform dates and use
the open cycle's pinned constitution for catch-up. Decision 41 records these changes.
Documentation numbering cleanup unrelated to these changes remains separate work.

**T3. Screens for backends that already exist — completed.**
- Contributions: Treasurer uploads/replaces/removes JPEG, PNG or PDF proof against
  captured contributions; authorised readers can view/download it. The cycle selector
  exposes the current cycle and the latest 24 cycles from the existing history API.
- Contributions: paged penalty register with all/outstanding/settled/waived filters;
  Chairperson waiver requires a reason and uses the existing reversing-entry service.
  Members see only their own penalties and proof; officers see the club register.
- Queue: Chairperson arranges every active candidate using Up/Down controls for the
  Negotiated method and confirms the agreed order. The server revalidates membership
  before saving. Random draw and Seniority retain their existing flows.
- Evidence: `node server/integration/screens.js`; decision 40. No new migration.

## 4. Priority 1 - requirements not yet built

Sizes: S under half a day, M about a day, L two days or more. Owner column is for you.

### 4.1 Missing use cases (needed for the "7 use cases" demo)

**T4. UC5 Reconciliation - REQ-96, 97, 98.** (M)
Treasurer records the bank closing balance on a date (permission `reconciliation.record`
already exists). A view compares ledger pool balance, total contributions captured and
the bank balance. Any non-zero difference is shown as an exception and cannot be
dismissed without an explanation. Existing: `reconciliation` table with one seeded
unexplained difference. Needs: repo, service, routes, one page, tests.

**T5. UC7 Governance — completed follow-on, migrations 016 and 017.**
Includes recorded constitutional voting rules (no assumed majority), exact fractions,
class-specific amendment thresholds and voting rights; pending proposals; attendance,
quorum and immutable vote outcomes; atomic version creation; voted officer succession
and expulsion with queue removal. Membership history is recorded from migration 017
forward. Old unconfirmed votes remain readable but cannot be newly applied.
`/governance` also includes the annual report in REQ-110. Actual adopted voting rules
must be supplied by the club; the documents do not provide numerical thresholds.
See decisions 37–39 and `npm run test:governance`. T7/T10 and reconciliation capture
remain separately assigned. No shared database has been migrated here.

**T6. Ledger reversals — implemented with migration 018.**
Treasurer posts an equal/opposite entry with the original reference and a reason.
Payout/claim reversals follow request → Chairperson approval → Treasurer posting.
Original records stay immutable; duplicate, cross-club and reversal-of-reversal
attempts are refused. The Ledger screen exposes requests and actions.
REQ-63's Chairperson penalty-waiver flow remains the exception to general REQ-92.
See decision 42 and `node server/integration/ledger-reversals.js`.

**Boundary to resolve separately:** ledger reversal does not rewind contribution
allocations/credits, queue positions or claim/payout workflow status. That requires
source-operation compensation rules and allocation history not provided by these
requirements. Do not treat a ledger reversal as cancellation of the original process.

### 4.2 Member lifecycle

**T7. Standing engine and defaulter pipeline - REQ-44, 101, 102, 103.** (L)
The automatic standing pipeline is still outstanding. Governance now changes standing
on an approved expulsion, but automated warning/suspension/reinstatement remains
assigned to another member. Payout eligibility, arrears rulings, claim eligibility and
distributions all depend on it, so in real use they would run on stale data.
Build: a pipeline Warning, Suspension, Expulsion advancing on thresholds in the
constitution (there are no threshold columns yet, so add them and validate them in
`rules/constitution.js`), automatic return to Good standing when arrears and penalties
are cleared, with the date recorded. Expulsion must wait for a resolution (T5).

**T8. Exit processing - REQ-40 (exit date), 45, 46, 47, 48.** (L)
Nothing sets a member to Exited or records an exit date. Build: notice of exit, compute
repayable and forfeited amounts from the constitution's forfeiture rule, Chairperson
approval, post to the ledger only on approval, and refuse exit for the member next in a
Rotating club's queue who has an outstanding contribution. Reuse: payout type
`Exit settlement` already exists in the schema, `removeFromQueue()` in
`queue.service.js` is ready to call, and distributions already leave Exited members out
(decision 28), on the assumption this exists.

**T9. Beneficiaries - REQ-36.** (M)
Member nominates beneficiaries with name, relationship and percentage share; shares must
total 100. The `beneficiary` table exists; there is no code at all.

### 4.3 Communication

**T10. Notifications - REQ-6 (lockout notice), 61, 62, 136 to 141.** (L)
Nothing is sent today; the lockout is only written to the audit log. Suggested order:
(1) a notification table and in-app feed, which needs no outside service; (2) member
channel preferences (REQ-136); (3) events (REQ-137); (4) delivery record and retry at
15 minutes, 1 hour, 6 hours (REQ-138, 139); (5) undeliverable list for the Secretary
(REQ-140). SMS and email need a provider account, so do those last. REQ-141: no
notification may contain a password, full ID number or bank account number.

**T11. Announcements - REQ-129 to 135.** (M)
Chairperson or Secretary publishes; author, time, subject, body recorded; shown newest
first; cannot be edited or deleted; a correction is a new announcement referencing the
old one; no replies. Sending to channels (REQ-132) depends on T10.

### 4.4 Reporting and screens

**T12. Dashboards and annual report - REQ-110 to 118.** (L)
REQ-110 annual report is now implemented on Governance (decision 39).
The role-specific dashboards and chart/drill-through work remain.
Today there is one generic dashboard for every role. The SRS wants separate Member,
Treasurer, Chairperson and Platform Administrator dashboards, a 12-month income and
expenditure series, exceptions highlighted, every figure drawn from the same query as
its detail view, and drill-through. REQ-110 is covered by the governance report.

**T13. Batch capture - REQ-58.** (S)
Treasurer captures contributions for several members in one operation with a running
total. Reuse `captureContribution()` in a loop inside one transaction.

**T14. Export - REQ-100.** (M)
Ledger and member statement as a printable PDF.

**T15. Password re-entry - REQ-11.** (S) Federated sign-in - REQ-3. (M, needs
provider credentials, lowest priority.)

### 4.5 Already assigned

**Assistant - REQ-119 to 128.** Another group member.

Also assigned to other members and excluded from this governance update:
REQ-3 (federated sign-in), REQ-11 (password re-entry), REQ-58 (batch capture),
REQ-100 (export), REQ-101–103 (defaulter pipeline), notifications and
Reconciliation (Use Case 5). The annual governance report only reads existing
reconciliation records; it does not implement reconciliation capture.

## 5. Decisions the group must make first (changes to the SRS)

These came from the group and the lecturer. Each one contradicts a requirement that is
written down and already built, so update the SRS first, then build. Do not start
without that, or the code and the marked document will disagree.

**D1. The Chairperson creates the club and the Platform Administrator approves it.**
Contradicts REQ-18 ("only the Platform Administrator may create a club"). Today the
route is `POST /api/platform/clubs` guarded by `platform.provision`, and the club
status is only `Active` or `Suspended`. To build: a `Pending` status, a request route
for a prospective Chairperson, an approve or reject action on the platform page, and
a rule that a Pending club cannot be used. Decide who the "leader" is before they have
an account or a club.

**D2. An officer of one club can only be an ordinary member elsewhere.**
Contradicts REQ-10 ("a user may hold different roles in different clubs"). The seed
deliberately has Nomsa Maluleke as Treasurer of one club and a member of another to
prove REQ-10, so the seed and its tests must change too. Decide whether the rule covers
Chairperson, Treasurer and Secretary (as noted) and what happens to existing holders.

**D3. Email the new account holder their login details.**
Not in the SRS, and REQ-141 says no notification may contain a password. Suggested
design that satisfies both: send a one-time link to set their own password, and state
that they log in with their phone number, so nobody, including the officer who created
the account, ever sees or relays a password. Needs an email provider (SMTP or a service
such as SendGrid, Postmark or SES); until then write it against a stub that logs the
message.

**Done, but not in the SRS:** officer caps (one Chairperson; Treasurers 1 plus 1 per 100
members; Secretaries 1 plus 1 per 150). Add it to the SRS if it should be assessed.

## 6. Documentation to correct

- Ledger numbering is now corrected to REQ-89–95. Audit remaining sections against
  the supplied SRS before submission.
- `docs/traceability.md` says the Assistant is REQ-110 to 118. In the SRS it is
  REQ-119 to 128; REQ-110 to 118 are the annual report and dashboards.
- Thirty SRS requirements are never mentioned in `traceability.md`: REQ-40, 44 to 48,
  99, and 119 to 141. REQ-99 (audit log) is built and needs a row. The rest are the
  tasks above.
- The decisions file is `Docs/Desicions.md` (capital D, spelling) but the README and
  hand-off call it `docs/decisions.md`. Pick one.
- The hand-off note said `web/components/ui/icons.js` and `Money.js` exist. They do not;
  pages use `lucide-react` and `money()` directly. Update the hand-off.

## 7. Suggested order if time is short

1. Remaining documentation numbering cleanup (T2 date/cycle fixes and T3 screens are done).
2. T4 Reconciliation remains. T5 Governance is implemented; apply migrations 016 and 017
   and run the governance demo checks.
3. T7 Standing engine, then T8 Exit processing.
4. T12 role dashboards remain; T6 ledger reversals are implemented. T13 is assigned.
5. T10, T11, T14, T15 last; leave what does not fit in `traceability.md` under
   "Not yet implemented" so the marker sees it was a decision, not an oversight.
6. D1, D2, D3 only after the SRS is amended.