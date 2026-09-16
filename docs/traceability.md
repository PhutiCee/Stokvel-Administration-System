# Requirements traceability

SRS 5.4 commits this system to demonstrable traceability from each functional
requirement to the code that implements it and the evidence that it works. This
is that record, as at the Milestone 4 preliminary release.

Evidence is one of:

- **automated** — a test in `server/tests/`, run by `npm test`
- **database** — enforced by a constraint, index or trigger, so it cannot be
  bypassed by application code
- **manual** — demonstrable in the running system; the demonstration step is named

Requirements not listed are not yet implemented. They are collected at the end.

---

## Use Case 1 — Authenticate and select club context

| REQ | Requirement | Implemented in | Evidence |
|---|---|---|---|
| REQ-1 | Unique username; failure message does not disclose whether the account exists | `modules/auth/auth.service.js` → `GENERIC_FAILURE`, `auth.repo.js` → `findByIdentifier` | manual: sign in with a wrong password, then an unknown number — identical message. A dummy verification runs on the unknown-account path so the response time matches too |
| REQ-2 | Passwords stored under a key-derivation function | `lib/password.js` (scrypt, N=2¹⁵) | automated: `password.test.js` — plaintext absent from the stored value, per-password salt, self-describing format |
| REQ-3 | Federated identity as an alternative | — | **not implemented.** Deliberately absent from the sign-in page rather than shown as a dead control. See `decisions.md` §8 |
| REQ-4 | Session token, 30 minutes of inactivity | `middleware/authenticate.js` → `resolveActor` slides `expires_at` on each request | manual: the session cookie returns `HttpOnly`; the token appears nowhere in the response body |
| REQ-5 | Server-side invalidation on sign-out | `auth.service.js` → `terminateSession`, `session.terminated_at` | manual: sign out, then reuse the cookie → `UNAUTHORISED` |
| REQ-6 | Five failures locks the account for 15 minutes | `auth.service.js` → `authenticate`, `auth.repo.js` → `recordFailedAttempt` | manual: six wrong attempts; the correct password is then refused with the minutes remaining |
| REQ-7 | One role per club from the named set | `member.role` enum, `rules/permissions.js` | database: `member_role` enum; automated: `rules.test.js` |
| REQ-8 | Every operation authorised against the role held in the ACTIVE club | `middleware/authorize.js`, `middleware/authenticate.js` (role joined fresh per request) | automated: `rules.test.js`; manual: same session, Treasurer in one club and Member in another |
| REQ-9 | Audit log of authentication, refusals and financial operations | `middleware/audit.js` → `record`, called from every service | manual: `SELECT action, outcome, count(*) FROM audit_log GROUP BY 1,2` |
| REQ-10 | Different roles in different clubs on one account | `member` unique on `(club_id, user_id)`; role read per request | manual: Nomsa Maluleke — Treasurer of Mmakau, Member of Bokamoso |
| REQ-11 | Re-enter password for sensitive operations | — | **not implemented.** Scheduled with the payout engine |
| REQ-12 | Every record other than the account is club-scoped | migrations 003–007: `club_id` on every table | database |
| REQ-13 | No retrieval may return another club's record | `db/pool.js` → `forClub` refuses any statement touching a club-scoped table without a `club_id` predicate | manual: a query missing the predicate throws immediately, naming the requirement |
| REQ-14 | A foreign record reads exactly as a missing one | `middleware/tenancy.js` → `assertOwned` throws `NotFound`; the attempt is audited with the real reason | manual: request a club you do not belong to → `NOT_FOUND`, never `FORBIDDEN` |
| REQ-15 | One account, several clubs | `auth.repo.js` → `listMemberships` (scoped by `user_id`) | manual: the club selector |
| REQ-16 | Club selector after authentication | `web/app/select-club/page.js` | manual |
| REQ-17 | Change the active club without signing out | `auth.service.js` → `switchClubContext`; membership checked inside the same statement that performs the switch | manual: switch club, permission count changes on the same session |

## Platform administration

| REQ | Requirement | Implemented in | Evidence |
|---|---|---|---|
| REQ-18 | Only the Platform Administrator creates, suspends and reinstates a club | `modules/platform/`, `middleware/tenancy.js` → `requirePlatformAdmin` | manual |
| REQ-19 | Administrator denied member-level and transaction-level records | `requireClubContext` refuses `isPlatformAdmin` outright | manual: `/api/club`, `/api/members`, `/api/ledger` all refused |
| REQ-20 | Aggregate statistics only, no club-level or member-level detail | `platform.service.js` → `aggregate`, `listClubs` carries no financial column | automated-adjacent: the club list is asserted to contain no balance field in the regression run |
| REQ-21 | A suspended club refuses writes; members keep read access | `middleware/tenancy.js` — refuses non-GET only | manual: suspend, then read a statement (works) and capture (refused) |

## Club setup and constitution

| REQ | Requirement | Implemented in | Evidence |
|---|---|---|---|
| REQ-22 | Club type from the named set | `club_type` enum, `rules/constitution.js` | database; automated |
| REQ-23 | Contribution, frequency, commencement date | `constitution` table, `platform.service.js` → `createClub` | automated: `rules.test.js` |
| REQ-24 | Penalty amount and grace period | `constitution` table | automated |
| REQ-25 | Quorum threshold as a percentage | `constitution.quorum_percentage` | automated |
| REQ-26 | Exit notice period and forfeiture rules | `constitution` table | automated |
| REQ-27 | Burial: covered categories and benefit amounts | `constitution.benefit_schedule` (JSONB) | automated: a burial club without a schedule is refused |
| REQ-28 | Rotating: initial payout order method | `constitution.payout_order_method` | automated |
| REQ-29 | Validate for internal consistency before activation | `rules/constitution.js` → `validateConsistency` | automated: grace ≥ cycle length, quorum outside 1–100, contribution ≤ 0 all refused |
| REQ-30 | An amendment creates a new version | `constitution` unique on `(club_id, version)`; no update path exists | database |

## Membership

| REQ | Requirement | Implemented in | Evidence |
|---|---|---|---|
| REQ-34 | Name, identifier, phone, and email **or** postal address | `members.service.js` → `validateRegistration`; migration 008 constraint | database: `contact_channel_present`; manual: registration without either is refused |
| REQ-35 | Next of kin recorded | `member.next_of_kin` (JSONB), required by the form | manual |
| REQ-38 | Reject a duplicate active member of the same club | `members.repo.js` → `isActiveMemberOfClub` | manual: registering Nomsa twice → `CONFLICT` |
| REQ-39 | The same person may belong to several clubs | `members.repo.js` → `findAccountByIdOrPhone` reuses the account | manual: registering Solomon into a second club reports `reusedAccount: true` |
| REQ-41 | Catch-up obligation presented **before** membership is confirmed | `members.service.js` → `previewCatchUp`; two-step `POST /preview` then `POST /` | manual: the preview writes nothing and returns the figure with its explanation |
| REQ-42 | A new member joins the end of the rotating queue | `members.repo.js` → `nextQueuePosition` | manual |
| REQ-43 | Only the Secretary or the Chairperson may register, amend and assign roles | `rules/permissions.js` | automated: `rules.test.js` asserts both roles hold all three |
| REQ-49 | A club must always have a Chairperson and a Treasurer | `members.service.js` → `assignRole` refuses the last holder; `createClub` appoints a chairperson at formation | manual: demoting the only Treasurer is refused, naming the requirement |

## Use Case 2 — Contributions

| REQ | Requirement | Implemented in | Evidence |
|---|---|---|---|
| REQ-50 | Expected record for every member **in good standing** at cycle commencement | `contributions.service.js` → `openCycle`, `repo.membersForNewCycle` | manual |
| REQ-51 | Capture amount, receipt date and method | `contributions.service.js` → `captureContribution` | automated (guards); manual (capture) |
| REQ-52 | An electronic transfer must carry its reference | `rules/contributions.js` → `checkMethod` | automated |
| REQ-53 | Proof-of-payment upload | `contribution.proof_url` column exists; upload not built | **partial** |
| REQ-54 | Status from the named set, recomputed on every capture | `rules/contributions.js` → `resolveStatus`; also recomputed on read | automated: nine boundary cases |
| REQ-55 | Outstanding until due; Late once due date and grace have both elapsed | `resolveStatus` | automated: grace runs to the end of its last day |
| REQ-56 | Penalty posted automatically on resolving to Late, once only | `captureContribution` uses the status **before** the payment; migration 009 unique index | database: `penalty_one_per_member_cycle`; manual: paying late in full still incurs it, twice does not |
| REQ-57 | Excess applied to penalty, then prior arrears oldest first, then credit | `contributions.service.js` → `applyExcess` | manual: R2 000 against a R500 cycle splits across all three tiers, in order |
| REQ-59 | Refuse capture against a closed cycle | `captureContribution` | manual: `RULE_REFUSAL` naming the reversing-entry route |
| REQ-60 | Refuse an amount of zero or less | `rules/contributions.js` → `checkCaptureAmount` | automated |

## Ledger

| REQ | Requirement | Implemented in | Evidence |
|---|---|---|---|
| REQ-88 | Every financial event posted to the ledger | `ledger.service.js` → `appendEntry` | manual |
| REQ-89 | Entries carry a running balance | `ledger_entry.resulting_balance`, computed under a club row lock | manual: the running balance reconciles line by line in date order |
| REQ-90 | No posted entry may be altered or removed | migration 006 triggers | database: `UPDATE` and `DELETE` both raise |
| REQ-91 | Correction by reversing entry, with a reason | `reverses_id`, `reversal_needs_reason` constraint | database |
| REQ-92 | Only the Treasurer may post | `rules/permissions.js` | automated |
| REQ-93 | Fixed-precision monetary arithmetic | `lib/money.js` (integer cents); `NUMERIC(12,2)` columns; the `pg` numeric parser is deliberately left returning strings | automated: `rules.test.js` |
| REQ-94 | Member statement: every entry affecting them, chronological, running balance | `ledger.service.js` → `generateMemberStatement` | manual: a member reads their own; another member's is refused |
| REQ-95 | Every member sees the club pool balance | `GET /api/ledger/pool`, permission `view.pool` | automated (permission); manual |

---

## Not yet implemented

Scheduled for the sprints after the preliminary release.

**Payout engine (Use Case 3)** — REQ-64 to REQ-80. The permission split is already
in place and tested (`payout.initiate` and `payout.approve` are held by different
roles), but no payout can yet be raised.

**Burial claims (Use Case 4)** — REQ-81 to REQ-87. The dependant table, waiting
period and benefit schedule are all captured; assessment is not built.

**Reconciliation (Use Case 5)** — REQ-96 to REQ-98. The table exists and is seeded
with a deliberate unexplained difference; the view is not built.

**Assistant (Use Case 6)** — REQ-110 to REQ-118.

**Governance (Use Case 7)** — REQ-104 to REQ-109. Meetings, quorum and resolutions.

**Defaulter pipeline** — REQ-101 to REQ-103.

**Notifications** — REQ-61, REQ-62, and the REQ-6 lockout notice. Nothing is
despatched yet; the lockout is recorded in the audit log instead.

**Also outstanding:** REQ-3 (federated sign-in), REQ-11 (password re-entry for
sensitive operations), REQ-53 (proof-of-payment upload), REQ-58 (batch capture),
REQ-63 (penalty waiver), REQ-100 (export).

---

## Running the evidence

```bash
npm test     # 53 automated tests, no database required
npm run check  # every relative import resolves
```

The automated tests exercise the rules engine, the permission matrix, monetary
arithmetic and password storage. They need no database and no network, so they
run even when the database is unreachable — which is the point of keeping the
rules pure.