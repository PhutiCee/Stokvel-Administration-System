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
| REQ-30 | An amendment creates a new version; prior versions retained; effective date recorded | `constitution` unique on `(club_id, version)`; migration 010 triggers refuse `UPDATE` and `DELETE` and require consecutive version numbers with strictly later effective dates; `constitution.service.js` -> `createNewVersion` | database: `UPDATE`, `DELETE`, a version-number gap and a backwards effective date all raise; automated: `versioning.test.js` |
| REQ-31 | Every rule evaluated against the version in force on the date of the transaction, not the current one | `rules/versioning.js` -> `versionInForce` (the single resolver); `constitution.service.js` -> `getVersionInForceOn`; `GET /api/constitution/in-force?date=` | automated: `versioning.test.js` (on, before and after an effective date; order independence; tie-break); `payouts.service.js` and `claims.service.js` both call the resolver. **Partial:** the contribution and penalty code still resolve the version with their own SQL |
| REQ-32 | Amendment requires a carried, quorate resolution | `governance.service.giveEffect` + transactional `createNewVersion` | `test:governance`: advisory refusal, stale vote refusal, atomic rollback |
| REQ-33 | An amendment applies prospectively only | `rules/versioning.js` -> `validateNewVersion` refuses an effective date in the past | automated: `versioning.test.js`. **Partial:** an amendment cannot be backdated, but a cycle already open when an amendment takes effect is not yet held on the old version |

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
| — | **Not an SRS requirement.** Officer roles are capped by club size: Chairperson always exactly one; Treasurer and Secretary scale with active membership | `rules/officers.js` → `maxHoldersFor`, `assessRoleCapacity`; applied in both `assignRole` and `registerMember` | automated: `officers.test.js`; integration: a second Treasurer refused under 100 members, allowed at 100+, a third still refused under 200; Chairperson capped at one regardless of size; a new member registered directly into an at-capacity role is refused with nothing created. See decisions.md, decision 34 |

## Use Case 2 — Contributions

| REQ | Requirement | Implemented in | Evidence |
|---|---|---|---|
| REQ-50 | Expected record for every member **in good standing** at cycle commencement | `contributions.service.js` → `openCycle`, `repo.membersForNewCycle` | manual |
| REQ-51 | Capture amount, receipt date and method | `contributions.service.js` → `captureContribution` | automated (guards); manual (capture) |
| REQ-52 | An electronic transfer must carry its reference | `rules/contributions.js` → `checkMethod` | automated |
| REQ-53 | Upload a proof-of-payment file against a captured contribution: JPEG, PNG or PDF, at most 5 MB | `contributions.service.js` -> `uploadProof`, `downloadProof`, `deleteProof`; `POST/GET /api/contributions/:id/proof`; migration 015 (`proof_of_payment`, bytes stored in the database, type and size both checked again by CHECK constraints); `contribution.proof_url` kept in step | integration: an oversized file and a disallowed type are each refused with nothing stored; the exact bytes come back on download; a second upload replaces the first rather than accumulating; `proof_url` is set on upload and cleared on delete ; T3 screen: `ProofPanel.js`, recent-cycle selector, member-only reads and signature checks; `integration/screens.js` covers actual HTTP uploads/downloads and access refusals |
| REQ-54 | Status from the named set, recomputed on every capture | `rules/contributions.js` → `resolveStatus`; also recomputed on read | automated: nine boundary cases |
| REQ-55 | Outstanding until due; Late once due date and grace have both elapsed | `resolveStatus` | automated: grace runs to the end of its last day |
| REQ-56 | Penalty posted automatically on resolving to Late, once only | `captureContribution` uses the status **before** the payment; migration 009 unique index | database: `penalty_one_per_member_cycle`; manual: paying late in full still incurs it, twice does not |
| REQ-57 | Excess applied to penalty, then prior arrears oldest first, then credit | `contributions.service.js` → `applyExcess` | manual: R2 000 against a R500 cycle splits across all three tiers, in order |
| REQ-59 | Refuse capture against a closed cycle | `captureContribution` | manual: `RULE_REFUSAL` naming the reversing-entry route |
| REQ-60 | Refuse an amount of zero or less | `rules/contributions.js` → `checkCaptureAmount` | automated |
| REQ-63 | Chairperson may waive a penalty; a reason is required; posted as a reversing entry, never a deletion | `rules/penalties.js` → `assessWaiver`; `contributions.service.js` → `waivePenalty`; migration 014 | automated: `penalties.test.js`; database: a waiver with no reason raises `23514`, and a recorded waiver cannot be reworded or undone (`23001`); integration: the reversing entry exactly undoes the original amount, one reversal per entry, BR-13's double-waiver refused ; T3 screen: `Penalties.js`, paged/filterable `GET /api/contributions/penalties`; `integration/screens.js` verifies role, reason, isolation and single reversal |

## Ledger

| REQ | Requirement | Implemented in | Evidence |
|---|---|---|---|
| REQ-89 | Every financial event records club, timestamp, type, member, amount, actor and resulting balance | `ledger.service.js` → `appendEntry`, club row lock | Ledger integration verifies reversal values and pool balance |
| REQ-90 | No posted entry may be altered or removed | migration 006 triggers | database: `UPDATE` and `DELETE` both raise |
| REQ-91 | Equal/opposite correction with original reference and reason | `reversals.service.js`, migration 018, Ledger screen | `integration/ledger-reversals.js`: exact amount, duplicate guards, immutable original and rollback |
| REQ-92 | Treasurer posts reversals; payout reversal needs prior Chairperson approval | `reversals.service.js`, `ledger.reverseApprove`, migration 018 | Real HTTP permissions and approval/posting tests; REQ-63 waiver exception recorded in decision 42 |
| REQ-93 | Fixed-precision monetary arithmetic | `lib/money.js` (integer cents); `NUMERIC(12,2)` columns; the `pg` numeric parser is deliberately left returning strings | automated: `rules.test.js` |
| REQ-94 | Member statement: every entry affecting them, chronological, running balance | `ledger.service.js` → `generateMemberStatement` | manual: a member reads their own; another member's is refused |
| REQ-95 | Every member sees the club pool balance | `GET /api/ledger/pool`, permission `view.pool` | automated (permission); manual |

---

## Payouts and payout queue (Use Case 3, rotating clubs)

Rotation payouts only. Distributions and burial claims (below) are also
built, each authorising and posting through the same `payout` table.

| REQ | Requirement | Implemented in | Evidence |
|---|---|---|---|
| REQ-64 | Initiated by the Treasurer, approved by a different account, before posting | `payouts.service.js` -> `initiatePayout`, `approvePayout`; `payout_two_people` constraint (migration 011) | database: `approved_by = initiated_by` raises `23514` even bypassing the service; automated + integration: initiating and approving with the same account is refused |
| REQ-65 | At approval, the recipient, amount, rule and resulting pool balance are shown | `payouts.service.js` -> `getPayout` returns `assessmentNow`, re-computed at read time, not the stale figure from initiation | integration: the approver's view reflects a pool change made after initiation |
| REQ-66 | Refuse a payout whose amount exceeds the pool | `rules/payouts.js` -> `assessRotationPayout`, checked at both initiation and approval | automated: `payouts.test.js`; integration: a payout initiated when the pool was sufficient is refused at approval once it no longer is |
| REQ-67 | Refuse a payout to a Suspended or Expelled member | `rules/payouts.js` -> `assessRotationPayout` | automated: `payouts.test.js`; integration: standing changed after initiation is caught at approval |
| REQ-68 | Record the initiator, approver, both timestamps and the rule applied | `payout` table columns; `eligibility_rule_applied`, `assessment_at_initiation`, `assessment_at_approval` | database: `payout_state_shape` and `payout_guard()` (migration 011) make the initiation facts immutable once approved |
| REQ-69 | Notify the recipient on posting | not built | **not met yet.** Notifications (see Not yet implemented) are a separate service; the payout is complete without it |
| REQ-70 | Treasurer may cancel an Initiated payout, with a reason | `payouts.service.js` -> `cancelPayout` | automated + integration: cancelling frees the cycle for a later payout; a reason is required; an Approved payout cannot be cancelled |
| REQ-71 | Ordered payout queue, established by the constitution's method | `rules/queue.js` -> `drawOrder`, `seniorityOrder`, `checkProposedOrder`; `queue.service.js` -> `establishQueue` | automated: `queue.test.js`; integration: all three methods (Random draw, Seniority, Negotiated) against seeded data ; T3 screen: `NegotiatedOrder.js`; `integration/screens.js` verifies candidates, malformed/stale order refusal and exact saved order |
| REQ-72 | Only the member at the head may be initiated | `rules/payouts.js` -> `assessRotationPayout` | automated + integration |
| REQ-73 | Queue advances on posting; recipient goes to the end | `queue.service.js` -> `advanceAfterPayout`, called inside `approvePayout`'s transaction | integration: the paid member moves to the end, everyone else moves up one, in the same order |
| REQ-74 | A member may request an exchange with a named other member; recorded pending | `queue.service.js` -> `requestSwap` | automated + integration |
| REQ-75 | Exchange effected only on the other member's express consent AND Chairperson approval, both recorded | `queue.service.js` -> `consentToSwap`, `approveSwap`; `swap_effected_needs_both` constraint | database + integration: approval before consent is refused; the database itself refuses an `Effected` row with no consent |
| REQ-76 | Queue recomputed on admission, exit, expulsion and exchange; relative order of everyone else preserved | `rules/queue.js` -> `removeMember`, `appendMember`, `swap`; `queue.service.js` -> `removeFromQueue` | automated: `queue.test.js`; integration: removing a member closes the gap without disturbing anyone else's order |
| REQ-77 | Queue cannot advance past a member In arrears; Chairperson defers or pays notwithstanding, recorded | `queue.service.js` -> `resolveArrears`; `queue_arrears_decision` table | automated + integration: both options exercised; a Suspended member can only be deferred, never paid (REQ-67) |
| REQ-78 | Every member sees their own position and a projected date | `rules/queue.js` -> `projectHeadDates`; `GET /api/queue/me` | automated: `queue.test.js`; integration: dates step forward by one cycle per position, by the constitution's frequency |

**Not yet covered here:** a member joining mid-rotation is placed by
`members.repo.js` -> `nextQueuePosition` (REQ-42), predating this sprint; it is
not re-verified against `rules/queue.js` -> `appendMember`, which exists for
symmetry and for the exit/expulsion path to use later.

---

## Year-end distributions (Use Case 3, accumulating clubs)

REQ-79's year-end date, REQ-80's formula, REQ-81's exact reconciliation and
REQ-82's itemised approval. Shares its dual-authorisation and posting
mechanism with rotation payouts (`payout` table, `payout_guard()`), but as one
computation covering every member, not one payout at a time.

| REQ | Requirement | Implemented in | Evidence |
|---|---|---|---|
| REQ-79 | Distribute at the year-end date named in the constitution | `constitution.year_end_month/day` (migration 012); `lib/dates.js` -> `nextYearEndAfter`; `distributions.service.js` -> `resolvePeriod` | automated: `distributions.test.js`; integration: not-yet-due is refused and states the date it falls due |
| REQ-80 | Each member's share: captured contributions, less unwaived penalties, plus a proportionate share of interest, less a proportionate share of administrative costs | `rules/distributions.js` -> `computeShares`; `distributions.service.js` -> `recordInterest`, `recordExpense` (the two figures the formula needs, with nowhere else to come from — see decisions.md) | automated: `distributions.test.js`; integration: a member's share reflects both an interest entry and an expense entry recorded mid-period |
| REQ-81 | Refuse to post a distribution whose shares do not sum to the pool exactly | `rules/distributions.js` -> `allocateProportionally` (largest-remainder method); `assessDistribution`, re-checked at approval by `verifyFrozenAssessment` | automated: `distributions.test.js` (every split reconciles to the cent, for both odd and even divisions); integration: activity between initiation and approval that breaks reconciliation is refused at approval, not silently absorbed |
| REQ-82 | Present the full computation, itemised by member, before posting | `distribution.assessment_at_initiation` (JSONB, frozen); `GET /api/distributions/:id` | integration: the itemisation shown at initiation is exactly what posts at approval, one ledger entry per member |

**Also enforced, the same way as rotation payouts:** REQ-64 (dual
authorisation: `distribution_two_people` constraint, migration 012), REQ-67 (a
Suspended or Expelled member is refused, re-checked at approval), REQ-68 (the
computation is frozen once approved, `distribution_guard()`), REQ-70
(cancellation, with reason, before approval).

**Assumptions this implementation makes, none of them stated in the SRS:**
REQ-80's "proportionate" is proportionate to each member's own net
contribution for the period; a member who has already exited is settled
separately and is excluded from a distribution; a member whose penalties
exceed their contributions produces a refusal rather than a debt carried
elsewhere. See decisions.md, decisions 26 to 29.

---

## Burial claims (Use Case 4)

REQ-37's dependants (a prerequisite this sprint did not omit, since a claim
cannot be assessed against a dependant that cannot be recorded), REQ-83's
lodgement, REQ-84 to REQ-87's eligibility, REQ-86's benefit resolution, and
REQ-88's strict lodged-order payment. A claim's own lifecycle (Lodged ->
Initiated -> Approved/Cancelled) is separate from a payout's: a claim can be
refused at lodgement for reasons that have nothing to do with money, before a
payout is ever considered.

| REQ | Requirement | Implemented in | Evidence |
|---|---|---|---|
| REQ-37 | Record a club's covered dependants: name, date of birth, category from the benefit schedule | `claims.service.js` -> `registerDependant`; category checked against the constitution in force today | automated: `claims.test.js` (via `resolveBenefitAmount`); integration: an unknown category is refused, naming the categories in force |
| REQ-83 | Lodge a claim on a deceased covered dependant: identity, date of death, supporting documentation | `claims.service.js` -> `lodgeClaim`; `POST /api/claims` | integration: a full lodgement, a future date of death, a malformed date |
| REQ-84 | Refuse a claim where the claimant's standing is not Good standing, stating why | `rules/claims.js` -> `assessLodgement` | automated: `claims.test.js`; integration: a suspended claimant is refused |
| REQ-85 | Refuse a claim where the deceased is not a covered dependant of the claimant | `rules/claims.js` -> `assessLodgement`; `dependant.member_id` checked against the claimant | automated + integration: another member's dependant, a dependant recorded after the death (BR-11), cover already ended before the death |
| REQ-86 | Benefit amount from the dependant's category and the benefit schedule in the constitution in force on the date of death | `rules/claims.js` -> `resolveBenefitAmount`; resolved once, at lodgement, and frozen (`burial_claim.benefit_amount`, migration 013) | automated: `claims.test.js`; integration: the Spouse category resolves to the seeded schedule's figure exactly |
| REQ-87 | Enforce the constitution's waiting period between a member's admission and the first date a claim may be lodged for their dependants | `rules/claims.js` -> `assessLodgement`, measured against the lodgement date, not the date of death (see decisions.md) | automated + integration: a member 95 days into a 180-day wait is refused, naming the exact eligible date |
| REQ-88 | Process claims in lodged order; where the pool cannot meet a valid claim, present the shortfall rather than paying in part | `claims.repo.js` -> `oldestLodgedClaim`; `rules/claims.js` -> `assessClaimPayment`; `claim_one_open_per_club` (migration 013) | integration: a later-lodged claim is refused ahead of an earlier unresolved one; an insufficient pool refuses outright, BR-12, with nothing posted |

**Also enforced, the same way as every other payout:** REQ-64 (dual
authorisation, `claim_two_people`), REQ-67 (a Suspended or Expelled claimant
is refused, re-checked at approval), REQ-70 (cancellation, with reason,
before approval; frees the dependant for a fresh claim).

**Not covered:** REQ-36 (a member's own nominated beneficiaries, by
percentage share) is a different mechanism for a member's own eventual
payout, not for a claim on a dependant's death, and is not built. A dependant
whose cover has ended (`removed_at`) cannot be removed a second time, and
cannot be removed at all once a live claim exists against them
(`dependant_guard_claimed`, migration 013).

---

## Governance (Use Case 7)

| Requirement | Behaviour | Implementation | Evidence |
|---|---|---|---|
| REQ-104 | Expulsion requires a carried resolution | `governance.service.giveEffect`, retained member row, queue removal and revoked club access | `test:governance`: expulsion, queue gap, last-officer refusal, session refusal |
| REQ-105 | Meeting date, agenda, attendees and minutes | `/governance`, `recordMeeting`, migration 016 | Unit and isolated database/HTTP tests |
| REQ-106 | Quorum from attendance and constitution | Frozen eligible count, required count, outcome and version | Unit: rounding/boundary; integration: snapshot |
| REQ-107 | Non-quorate decisions are advisory and never applied | Rules and database outcome guard | Unit and integration refusals |
| REQ-108 | Resolution text, for/against/abstaining votes and outcome | Immutable `resolution` row; totals equal attendance | Unit: invalid/tied/abstaining votes; database immutability |
| REQ-109 | Constitutional majority before amendment takes effect | Recorded class-specific voting rules, pending proposal, exact voted payload, atomic application | Integration: confirmed policy, proposal permissions, stale vote and rollback; decisions 37–38 supersede the initial assumptions |
| REQ-110 | Annual financial and membership report | `governance.annualReport`, `AnnualReport.js` | Integration: SA year boundaries, reversal netting, membership movement, reconciliation and tenancy |

The defaulter pipeline (REQ-101–103) and notifications remain separately assigned.
REQ-33 is enforced on new cycles using immutable version pins selected at
commencement. Legacy cycles retain the previous due-date selection at migration;
no historical money is rewritten (decision 38). Old assumed-majority votes are
readable but cannot be newly applied. No shared database was migrated for testing.

---

## Date handling and ledger corrections follow-on

| Requirement | Implementation | Evidence |
|---|---|---|
| REQ-31/33 | DATE strings; South African dates; catch-up uses the open cycle's pinned version | Decision 41; date-display tests and isolated integration |
| REQ-90/91 | Original immutable; equal/opposite reversal with reference and reason; one reversal per original | Migration 018; ledger-reversals integration, including database guards |
| REQ-92 | Treasurer posts; payout request → Chairperson approval → Treasurer posting | Actual HTTP role/tenant/approval tests; decision 42 records REQ-63 exception |

Decision 45 supersedes the original ledger-only boundary: tracked receipt allocations,
rotation queues and claims are compensated. Compound/legacy limits remain explicit.

---

## Historical gap inventory (superseded by current inventory)

Scheduled for the sprints after the preliminary release. The full, task-by-task list with sizes and suggested order is in `docs/remaining-work.md`.

**Reconciliation (Use Case 5)** — REQ-96 to REQ-98. The table exists and is seeded
with a deliberate unexplained difference; the view is not built.

**Assistant (Use Case 6)** — REQ-119 to REQ-128: implementation is now present
on `racha`; owned by another member. Compliance was not reassessed in this
governance change.



**Defaulter pipeline** — REQ-101 to REQ-103; assigned to another group member.

**Notifications** — REQ-61, REQ-62, and the REQ-6 lockout notice. Nothing is
despatched yet; the lockout is recorded in the audit log instead.

**Assigned to other group members (excluded from this update):** REQ-3 (federated sign-in), REQ-11 (password re-entry for
sensitive operations), REQ-58 (batch capture),
REQ-100 (export).

---

## Running the evidence

```bash
npm test     # 258 automated tests, timezone-independent calendar rules
npm run test:governance  # isolated PostgreSQL engine, no external database
node server/integration/screens.js  # T3 workflows, isolated database + HTTP
node server/integration/ledger-reversals.js  # ledger approvals, rollback and dates
npm run check  # every relative import resolves
```

The automated tests exercise the rules engine, the permission matrix, monetary
arithmetic and password storage. They need no database and no network, so they
run even when the database is unreachable — which is the point of keeping the
rules pure.


## Membership and communications update — 30 September 2026

This status supersedes earlier "not covered" statements for beneficiaries,
announcements, exit processing and role dashboard financial detail.

| Requirements | Evidence | Status |
|---|---|---|
| REQ-36 | beneficiaries module; `/beneficiaries`; integer-percent rules; completion tests | Implemented |
| REQ-40,45,46,48,49 | exits module, migration 019; `/exits`; atomic settlement and safeguards | Implemented for fully represented calculation mappings; free-text conditions remain restricted |
| REQ-47 | Migration 020, General resolution exact-debt snapshot, atomic write-off and exit; exit-writeoffs integration tests | Implemented: settle debts or use a carried exact-debt resolution |
| REQ-129–131,133–135 | announcements module/page; immutable DB trigger; linked same-club correction | Implemented |
| REQ-132 | Announcement table available as notification integration source | Assigned to notification owner; not dispatched here |
| REQ-111 | Own contributions, penalties, outstanding and shared queue projection | Implemented |
| REQ-112 | Officer month income, payouts/claims/costs, pool, arrears, read-only reconciliation | Implemented against existing ledger; penalty classification conflict in decision 43 |
| REQ-113 | Chairperson pending payouts/exits/amendments | Partial: pipeline stage counts await teammate |
| REQ-114 | Platform aggregate snapshot and expandable source totals | Implemented without club/member financial disclosure |
| REQ-115 | Previous 12 completed months chart and records | Implemented for Treasurer/Chairperson |
| REQ-116 | Non-zero reconciliation and >7-day overdue rotation indicators | Partial: near-expulsion pipeline alert awaits teammate |
| REQ-117–118 | Club detail rows and platform aggregate detail rows, each from a read-only snapshot | Implemented; platform detail remains aggregate under REQ-19/20 |

Repeatable evidence: `npm test`, `npm run test:completion`,
`npm run test:governance`, `node server/integration/screens.js`,
`node server/integration/ledger-reversals.js`, `npm run check`, `npm run build`.
No shared database was migrated and no code was pushed to GitHub.


### Exit write-off follow-on — 1 October 2026

Migration 020 adds immutable contribution_writeoff allocations and a separate
written_off_amount. General resolutions include the exact reviewed debts and use
recorded constitutional voting rules. Only a carried unapplied resolution matching
the pending notice and unchanged contribution snapshot can be consumed. Consumption,
zero-cash ledger evidence, repayment, queue removal and membership exit are atomic.
Expected and captured money remain unchanged. The UI labels historical rows
"Written off" and balance queries subtract forgiven amounts. No defaulter stages,
notification delivery or reconciliation capture were added.

`npm run test:exit-writeoffs` proves advisory/rejected/stale/wrong-member refusal,
rollback after allocation, immutable source history, duplicate prevention and no
cash capture after an exit. `npm run test:completion` also checks platform aggregate
sum-to-detail equality and access boundaries. See decision 44 for limits and handoff.


### Integrated follow-through — 1 October 2026 (supersedes older gap notes)

| Area | Current implementation and evidence |
|---|---|
| REQ-89–95 corrections | Atomic receipt allocation/credit compensation, rotation queue restoration and claim reopening; `test:source-compensation`. Legacy evidence and compound-workflow limits in decision 45. |
| REQ-45–48 exits | Explicit day/paid-cycle conditions, notice snapshot or settlement reevaluation; `exit-conditions.test.js`, existing completion/write-off suites. Other predicates remain unsupported. |
| UC5 / REQ-96–98 | Merged reconciliation page/API; dated ledger snapshot, gap explanation, permissions/tenant checks in `test:browser`. Full exception-resolution workflow remains owner work. |
| REQ-44,101–103 | Merged standing engine and rules tests; scheduling and adopted threshold configuration remain incomplete. |
| REQ-136–141 | Merged Secretary broadcast feed. External delivery, retries, preferences and event dispatch remain incomplete. |
| Confirmations/navigation | Real browser capture/reversal/recapture and rotation initiation/approval/reversal flow, mobile menu and member role checks in `test:browser`. Not exhaustive device acceptance. |

See `docs/integration-handoff.md` for reproducible commands and exact merged heads.


### Review fixes — 1 October 2026, migration 025

The current remaining-work inventory supersedes older status paragraphs above.

| Requirement / defect | Implementation | Evidence |
|---|---|---|
| Cycle lifecycle / REQ-59 | Treasurer closes via API/UI; grace protection, closure attribution, no reopening; debts preserved | review-fixes integration; browser flow |
| REQ-54–57 | Once-only late penalties on capture/close; excess can settle a newly assessed penalty | review-fixes; unattended grace-expiry scheduler remains outstanding |
| REQ-66,89,94–95,110,112 | cash_ledger_entry projection; original amounts retained, new cash balance stored; operational/report cash totals consistent | review-fixes and governance integration |
| REQ-119–128 answer defect only | Personal debt includes penalty/catch-up; explicit pool intent first | authenticated assistant checks in review-fixes; full feature remains owner work |
| Distribution input corrections | Net interest and expense reversals by original category | review-fixes; REQ-80/81 accounting agreement remains flagged |

Original historical reconciliation records and assessment-inclusive balances are
retained; fresh reconciliations use cash. See decision 47 for document conflicts.
