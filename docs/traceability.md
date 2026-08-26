# Requirements-to-interface traceability

Which SRS requirement each screen satisfies, and where in the code it lives. Keep
this current as screens change; it feeds directly into the final report.

| REQ | Requirement (abridged) | Where it is realised | File |
|---|---|---|---|
| REQ-1 | Authenticate before any club data | Login screen shows nothing before sign-in | `app/login/page.js` |
| REQ-1 | Message does not disclose whether the username exists | Single generic error string | `app/login/page.js` |
| REQ-7, REQ-10 | One role per club, roles differ across clubs | Nomsa: Treasurer in Mmakau, Member in Bokamoso | `lib/mock/seed.js` |
| REQ-8 | Permissions evaluated before every operation | Permission matrix gates nav and actions | `lib/rules/permissions.js` |
| REQ-13 | Every retrieval scoped to the active club | Every selector filters on clubId | `lib/data.js` |
| REQ-14 | Cross-club record indistinguishable from missing | `notFound()` rather than a refusal | `app/(club)/payouts/[id]`, `members/[id]` |
| REQ-16 | Club selector shows role and outstanding position | Selector cards | `app/select-club/page.js` |
| REQ-17 | Change club context without re-authenticating | Club switcher in the sidebar | `components/shell/ClubShell.js` |
| REQ-19, REQ-20, REQ-114 | Platform admin sees aggregate only | Separate shell, aggregate figures only | `app/platform/page.js` |
| REQ-29 | Constitution consistency validated | `validateConstitution` shown on screen | `lib/rules/index.js` |
| REQ-30, REQ-31 | Versioned constitution, version in force governs | Version history panel | `app/(club)/constitution/page.js` |
| REQ-34, REQ-35 | Member and next-of-kin details captured | Registration dialog | `app/(club)/members/page.js` |
| REQ-37 | Covered dependants recorded | Dependants panel on member detail | `app/(club)/members/[id]/page.js` |
| REQ-41 | Catch-up obligation for a mid-cycle joiner | Shown at registration, with the gap flagged | `app/(club)/members/page.js` |
| REQ-43 | Only Secretary or Chairperson registers | Register button gated by role | `app/(club)/members/page.js` |
| REQ-44 | Standing indicator | `StatusBadge`, icon plus word | `components/patterns/StatusBadge.js` |
| REQ-48 | Exited member retained | Rhulani Baloyi kept in the register | `lib/mock/seed.js` |
| REQ-51, REQ-52 | Capture with method and EFT reference | Capture dialog, conditional field | `app/(club)/contributions/page.js` |
| REQ-53 | Proof of payment, 5 MB, JPEG/PNG/PDF | Attachment control (flag only in prototype) | `app/(club)/contributions/page.js` |
| REQ-54, REQ-55 | Status resolution and lateness | `resolveContributionStatus` | `lib/rules/index.js` |
| REQ-56 | Penalty once per member per cycle, automatic | Seeded automatic penalty entries | `lib/mock/seed.js` |
| REQ-57 | Excess to penalties, then oldest arrears, then credit | `allocateExcess`, shown before confirming | `lib/rules/index.js` |
| REQ-58 | Bulk capture with a running total | Session counter in the page header | `app/(club)/contributions/page.js` |
| REQ-59 | No capture against a closed cycle | Validation refuses, advises reversal | `app/(club)/contributions/page.js` |
| REQ-60 | No capture of zero or less | Validation | `app/(club)/contributions/page.js` |
| REQ-63 | Penalty waiver as a reversing entry | Seeded waiver pair, visible in the ledger | `lib/mock/seed.js` |
| REQ-64 | Dual authorisation, not the same account | `canApprovePayout`, disabled with reason | `lib/rules/index.js` |
| REQ-65 | Assessment shown at the point of approval | Approval screen check list | `app/(club)/payouts/[id]/page.js` |
| REQ-66, REQ-67 | Refuse over pool, refuse suspended or expelled | `assessRotatingPayout` checks | `lib/rules/index.js` |
| REQ-68 | Initiator, approver and both timestamps recorded | Trail panel | `app/(club)/payouts/[id]/page.js` |
| REQ-70 | Treasurer may cancel before approval, with reason | Cancel dialog | `app/(club)/payouts/[id]/page.js` |
| REQ-71, REQ-72 | Ordered queue, no payout out of turn | Queue list; refusal names the head | `app/(club)/payouts/page.js` |
| REQ-73 | Queue advances on posting | `APPROVE_PAYOUT` reducer | `lib/store.js` |
| REQ-77 | Arrears at the head is the chairperson's fork | Fork surfaced in the assessment dialog | `lib/rules/index.js` |
| REQ-78 | Queue position and projected date to the member | Member dashboard card | `app/(club)/dashboard/page.js` |
| REQ-84 to REQ-88 | Burial claim assessment and no part payment | `assessBurialClaim` | `lib/rules/index.js` |
| REQ-89 | Ledger entry for every financial event | Every reducer that touches money appends | `lib/store.js` |
| REQ-90, REQ-91 | No amendment or deletion; reversal only | No edit affordance; reversal dialog | `app/(club)/ledger/page.js` |
| REQ-93 | Fixed-precision money, never floating point | Cent-rounded arithmetic, `tnum` display | `lib/format.js`, `lib/store.js` |
| REQ-94 | Member statement, chronological, running balance | Statement screen | `app/(club)/statement/page.js` |
| REQ-95 | Aggregate pool visible to every member | Member dashboard pool card | `app/(club)/dashboard/page.js` |
| REQ-96 to REQ-98 | Record bank balance, show difference, no silent clear | Reconciliation screen | `app/(club)/reconciliation/page.js` |
| REQ-100 | Export for printing and retention | Print stylesheet on statement and ledger | `app/globals.css` |
| REQ-111 to REQ-113 | Role-specific dashboards | Member and officer variants | `app/(club)/dashboard/page.js` |
| REQ-115 | Twelve-month income and expenditure series | `MiniChart` | `components/patterns/MiniChart.js` |
| REQ-116 | Exceptions distinguished from ordinary indicators | Exception band above the metrics | `app/(club)/dashboard/page.js` |
| REQ-117 | Dashboard figures from the same queries as detail | Both read the same selectors | `lib/data.js` |
| REQ-118 | Navigate from indicator to underlying records | `StatCard href` drill-through | `components/patterns/StatCard.js` |
| §3.1 | Club and role visible on every screen | Sidebar and topbar, both breakpoints | `components/shell/ClubShell.js` |
| §3.1 | Irreversible actions confirmed on a separate step | Two-step capture and approval dialogs | contributions, payouts |
| §3.1 | 360 px without horizontal scroll | Card layouts replace tables under `md` | contributions, ledger, members |
| §5.1 | ≤500 KB initial payload | ~103 kB first load; hand-rolled chart | build output |
| §5.3 | Identity numbers masked except to the secretary | `maskId` | `lib/format.js` |
| §5.4, §6.4 | Rules engine exercisable without the interface | Pure functions, no React import | `lib/rules/index.js` |
| §6.2 | Interface text at a plain reading level | Member-facing copy avoids jargon | throughout |

## Business rules

| Rule | How the interface honours it |
|---|---|
| BR-2 | Approval disabled with an explanation when the viewer initiated it. |
| BR-3 | No edit or delete affordance anywhere on a posted row. |
| BR-4 | Queue is an ordered list, not a sortable table. |
| BR-5 | Arrears at the head presents two recorded options, not a dead end. |
| BR-9 | Not-found semantics, never "not permitted". |
| BR-10 | Platform admin gets a different shell, not a greyed-out one. |
| BR-12 | Shortfall panel with no part-payment control. |
| BR-19 | Difference cannot be dismissed; only an explanatory entry clears it. |
| BR-20 | No "pay" verb anywhere. Capture, initiate, approve, post, reconcile. |
