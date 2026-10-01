# Design decisions

Decisions taken during implementation that depart from, or resolve an ambiguity
in, the approved SRS and Detailed System Design Document.

Each one is recorded here so it can be defended in the final presentation rather
than discovered by an assessor comparing the code against the documents.

---

## 1. Supabase as the PostgreSQL host

**SDD 4.2** describes a standard Linux virtual server running PostgreSQL 14+,
with the application server connecting over the local PostgreSQL protocol.

**Delivered:** managed PostgreSQL 15 on Supabase, reached over TLS.

**Why:** Supabase *is* PostgreSQL, so the version requirement is met exactly.
Managed hosting removes four separate local database installations from the
group's setup burden and guarantees every member is working against the same
schema.

**The boundary we hold:** Supabase is used as a database and nothing else. The
Supabase JavaScript SDK, PostgREST, Supabase Auth and Row Level Security are all
unused. Adopting any of them would move authentication and tenant isolation out
of the application tier, and the application tier is exactly where SDD 4.1
places them — the tenancy filter would become decoration rather than a control.
Access is through the standard `pg` driver and a pooled connection, as specified.

**The one real deviation:** the connection is TLS to a remote host rather than
local. Nothing in the application depends on the difference.

---

## 2. `pool_balance` is not stored on the club

**SDD 5.2.1** lists `pool_balance NUMERIC(12,2)` as a column on `Club`, annotated
"derived; reconciled to the ledger".

**Delivered:** the column does not exist. `getPoolBalance()` sums the ledger.

**Why:** a stored balance is a second source of truth. The moment it can differ
from the sum of the ledger, one of them is wrong, and there is no way to tell
which from the data alone. For a savings club that is not a performance
trade-off, it is a correctness problem — and the whole argument for an
append-only ledger is that the book is authoritative.

`ledger_entry.resulting_balance` *is* stored, which looks like the same thing but
is not. It is the balance as at one historical entry, needed to print a statement
without recomputing the entire book, and a gap in the running balance is visible
evidence of tampering. It is a record of the past, not a live figure.

**If the pool balance becomes slow** at a realistic number of entries, the fix is
a materialised view refreshed on write, not a mutable column.

---

## 3. The phone number is the username

**REQ-1** requires a unique username. The UI prototype used an email address.

**Delivered:** the phone number is the identifier; email is optional and may also
be used where present.

**Why:** the members of a burial society in Seshego have phones. Many do not have
an email address they can recall under pressure at an annual meeting. REQ-1 does
not specify the form of the username, and the phone number is unique, memorable,
and already recorded by the club for its own purposes.

The server normalises the input to digits, so `082 441 7788`, `0824417788`,
`+27 82 441 7788` and `0027824417788` all resolve to the same account. A member
should not be turned away over a space.

---

## 4. Opaque server-side sessions rather than JWT

**REQ-5** requires the server to invalidate the session token when a user signs
out.

**Delivered:** a random 32-byte token in an httpOnly cookie, with its SHA-256
digest stored in a `session` table.

**Why:** a self-contained token cannot be invalidated server-side without a
revocation list, and a revocation list is a session table by another name with
extra steps. Storing the digest rather than the token means a leaked database
dump does not hand over live sessions.

The active club is held on the session row, which is what makes REQ-13
enforceable. If the club context travelled in a header or a request body, the
client would be asserting its own tenancy and the filter would be checking the
attacker's own claim.

---

## 5. scrypt rather than argon2 or bcrypt

**REQ-2** requires a key-derivation function designed for password storage.

**Delivered:** `crypto.scrypt` from the Node standard library, N=2^15, r=8, p=1.

**Why:** scrypt is a genuine memory-hard KDF and satisfies the requirement.
Unlike argon2 and bcrypt it requires no native compilation, which matters when
four people have to get the project running on four different machines a week
before a deadline. The stored format is self-describing (`scrypt$N$r$p$salt$key`)
so the work factor can be raised later without invalidating existing hashes.

A failed sign-in against an unknown number runs a dummy verification so that the
response takes the same time as a real one. REQ-1 asks for a message that does
not disclose whether the account exists; a timing difference discloses it just as
effectively as the message would.

---

## 6. Cross-tenant access returns 404, not 403

**REQ-14** requires that a request for a record belonging to another club be
answered indistinguishably from a request for a record that does not exist.

**Delivered:** `NotFound` is thrown in both cases. The attempt is written to the
audit log with the real reason.

**Why:** 403 means "this exists and you may not have it", which is the exact
disclosure the requirement is written to prevent. The same rule applies to
`switchClubContext`: asking to enter a club you do not belong to returns "not
found among your memberships", not "forbidden".

---

## 7. The tenancy filter is enforced in the query layer

**SDD 4.1** describes the tenancy filter as middleware wrapping all data access.

**Delivered:** middleware supplies the club id, and `pool.forClub()` refuses to
execute any statement that touches a club-scoped table without a `club_id`
predicate.

**Why:** middleware that merely *makes the club id available* does not achieve
REQ-13. A developer can still forget the predicate and the bug is silent. Making
the failure loud and immediate turns "no query can be written that forgets it"
from an intention into a property of the system.

Four call sites legitimately bypass the guard and are listed in `pool.js`:
migrations, the sign-in path, `listClubMemberships` (which is scoped by
`user_id` and spans clubs by design), and the audit log (which must record
attempts made without a valid club context).

---

## 8. Federated sign-in is not on the sign-in page

**REQ-3** requires support for a federated identity provider as an alternative to
a password.

**Delivered:** password only, for now, with no Google button on the screen.

**Why:** it is not in the Milestone 4 slice, and Supabase Auth is excluded by
decision 1. A button that does nothing is worse than no button: it teaches the
member that the interface lies. REQ-3 is recorded as scheduled in the README
rather than mocked.

---

## 9. IBM Plex Sans in place of Inter

**Prototype:** Inter throughout.

**Delivered:** IBM Plex Sans, with IBM Plex Mono for ledger figures and reference
codes only.

**Why:** a book of account is a monospaced artefact — a column of figures whose
decimal points line up is the entire reason a ledger is set the way it is. Plex
gives one family with two widths in clearly distinct roles, and its tabular
figures are better than Inter's for this purpose. The colour tokens from the
approved prototype are carried over unchanged.

---

## 10. At most one open cycle per club, enforced by the database

**Not specified** in the SRS.

**Delivered:** a partial unique index, `cycle_one_open_per_club`.

**Why:** two treasurers pressing "open cycle" at the same moment would otherwise
both succeed, and every subsequent contribution would be captured against an
ambiguous cycle. A check in the service layer does not close that window; a
unique index does.

---

## 11. Payment methods corrected to match REQ-51

**Migration 005** defined the payment method enum as
`{Cash, Electronic funds transfer, Debit order}`.

**REQ-51** names `{Cash, Electronic funds transfer, Other}`.

**Delivered:** migration 009 rebuilds the type. This was a straightforward
defect: a club receiving a cheque or a postal order had nothing to record it as,
and "Debit order" is not a method any of the three seeded clubs actually uses.

A value cannot be removed from a PostgreSQL enum, so the column is widened to
text, the type dropped and recreated, rows remapped, and the column narrowed
again — all inside the migration's transaction.

---

## 12. REQ-43 gave register and amend to the Secretary alone

**REQ-43** permits *the Secretary or the Chairperson* to register a member,
amend a record and assign a role.

The first version of `rules/permissions.js` gave `member.register` and
`member.amend` to the Secretary only. Corrected, and now asserted in
`tests/rules.test.js` so it cannot regress.

---

## 13. REQ-21 was implemented backwards

**REQ-21:** a suspended club refuses all write operations *while continuing to
permit members read access to their own historical records*.

The first version of `middleware/tenancy.js` refused everything.

**Delivered:** only non-GET methods are refused. Suspension is an administrative
sanction against the club; it is not grounds for withholding from a member the
record of money they have already paid in.

---

## 14. The late penalty attaches to having been late, not to the closing status

**REQ-56:** post the penalty automatically upon the status resolving to Late.

The first implementation tested the status *after* the capture. A member who let
the deadline pass and then paid in full resolved straight to Paid and escaped
the penalty entirely — which is precisely the person the rule exists for.

**Delivered:** the penalty is decided from the member's position *before* the
payment is applied. Paying late in full still incurs it; paying in two
instalments incurs it once, enforced by the unique index in migration 009 rather
than by a check in the service, so two simultaneous captures cannot fine a
member twice.

A member who never pays at all is not reached by any capture. Their penalty is
levied when the cycle closes, which arrives with `closeCycle()`. Until then
their status still *reads* as Late everywhere, because it is recomputed on read.

---

## 15. The member statement runs oldest-first; the club ledger runs newest-first

**REQ-94** requires chronological order and a running balance, without saying
which direction.

**Delivered:** the club ledger is newest-first, because a treasurer opens it to
see what happened today. The member statement is oldest-first, because a person
reading their own history reads it forward.

The statement's running total is also computed from the member's own entries
rather than read from `ledger_entry.resulting_balance`. That column tracks the
*club pool*; showing it on a personal statement would tell a member the club's
balance and call it theirs.

---

## 16. The platform administrator sees three numbers and no breakdown

**REQ-20** requires aggregate statistics "without disclosing any club-level or
member-level detail".

**Delivered:** the administrator's screen shows the club count, the member count
and total funds under administration. There is no per-club financial figure
anywhere in the response — an administrator who could see per-club balances could
infer a great deal about a club's affairs without ever opening its ledger.

The club list carries name, type, status, town and member count, because REQ-18
requires the administrator to suspend a *named* club and that is impossible
without a list of names. The list stops at the point money begins.

---

## 17. A seeded record must survive the system's own rules

Not a requirement; a principle worth recording because it caught two defects.

The first seed invented identity numbers that failed the Luhn check the
registration form applies, and wrote ledger entries whose running balance did
not reconcile when read in date order.

Both would have been visible in the demonstration: a system rejecting data it
had itself created, and a book whose balance column jumps — which is exactly the
tamper signal that column exists to give.

**Delivered:** the seed recomputes each identity number's check digit, and writes
ledger entries in date order with distinct timestamps so the running balance
reconciles under any stable sort.

---

## 18. A constitution version is immutable in the database, and versions are ordered

**REQ-30** requires every constitution to be versioned and every prior version
retained. Migration 003 stored each version as its own row, but the table
allowed `UPDATE` and `DELETE`, and allowed version 3 to take effect before
version 2. The application had no code that did either, so the requirement held
only until someone wrote such a statement.

**Delivered:** migration 010. Triggers refuse `UPDATE` and `DELETE` on
`constitution`, the same way migration 006 protects the ledger. A third trigger
requires the next version to be numbered one higher than the last and to take
effect strictly later.

**Why the ordering matters:** "the version in force on a date" is the one with
the latest effective date not after that date. If a higher-numbered version could
take effect earlier, then on the dates between the two the older version would
be in force even though the newer one was adopted later, and two readers could
give different answers to the same question.

**What the database does not enforce:** that an amendment may not take effect in
the past (REQ-33). That is a business rule about new amendments. The seed and any
import of historical records legitimately insert past dates. It is enforced in
`rules/versioning.js`.

**Consequence:** deleting a club that has a constitution is now impossible, which
matches the ledger (`ON DELETE RESTRICT`). The system has no such operation.

---

## 19. Rules code handles calendar dates as text

The `iso()` helper used in the contribution service is
`new Date(d).toISOString().slice(0, 10)`. node-postgres builds a `Date` at local
midnight for a `DATE` column, and `toISOString()` converts that to UTC. On a
server running in South Africa (UTC+2) the date comes back one day early:
`2024-11-20` becomes `2024-11-19`. On a server in UTC it is correct, which is why
it was not noticed.

**Delivered for new code:** `lib/dates.js`. Dates that feed the rules engine
travel as `YYYY-MM-DD` strings, selected with `::text` in SQL, and never pass
through a `Date`. `todayIso()` returns today's date in Africa/Johannesburg, so a
club acting at 01:00 on the 21st is acting on the 21st even when the server is
still on the 20th in UTC. The versioning tests and the database checks were run
under `TZ=Africa/Johannesburg` and `TZ=America/Los_Angeles`.

**Not changed:** the existing `iso()` calls in the contribution service. Fixing
them is a separate change to established behaviour, because those calls decide
which constitution version a penalty is assessed against.

---

## 20. Recording an amendment has no HTTP route until governance exists

**REQ-32** says an amendment takes effect only after a member resolution meets
the quorum and majority thresholds. The resolution, quorum and outcome logic
belongs to Use Case 7, which is scheduled after this sprint.

**Delivered:** `createNewVersion()` in `constitution.service.js`, with the
validation in `rules/versioning.js`, and read-only routes
(`GET /api/constitution/versions`, `GET /api/constitution/in-force`). There is
deliberately no route that records an amendment.

**Why:** a route that recorded an amendment now would let the Chairperson change
the constitution without a resolution, which is the behaviour REQ-32 forbids. It
would also be a route the governance work would have to remove. The function is
ready for `giveEffect()` to call when a resolution passes.

---

## 21. A rotation payout pays out the cycle, not a fixed constitution amount

The SRS does not say how the amount a rotating payout pays is calculated. What
it does say (REQ-66) is that a payout must never exceed the pool balance, and
Use Case 2 already tolerates partial and outstanding contributions within a
cycle (REQ-56).

**Delivered:** the amount is the total actually captured for the earliest cycle
that has not yet been paid out, not `contribution_amount * member_count` from
the constitution. If every member has paid in full the two are the same
figure; when they are not, the constitution figure can exceed the pool, which
REQ-66 forbids outright. Paying out the captured total is always safe by
construction.

**Consequence:** a Treasurer initiating a payout is shown, as a note rather
than a refusal, how many members are still short and by how much (assessment
notes, `payouts.service.js`). The payout is not blocked on that: REQ-72 ties
payment to the queue position and the cycle's due date having passed, not to
full collection.

---

## 22. Eligibility is assessed twice: at initiation, and again at approval

REQ-64 requires two distinct officers. Between the Treasurer's initiation and
the Chairperson's approval, time passes, and the facts an eligibility decision
depends on can change: a member's standing, the pool balance, an exchange of
positions.

**Delivered:** `rules/payouts.js` -> `assessRotationPayout` is one function,
called from `payouts.service.js` at both `initiatePayout` and `approvePayout`.
The second call is not a rubber stamp: it re-reads the pool, the recipient's
current standing and any arrears ruling, and refuses the payout if any of them
have moved against it, even though it passed the first time. REQ-65 requires
the approver to be shown "the eligibility assessment on which the payout is
founded" — read as the assessment as it stands at the moment of approval,
because that is the assessment approval actually relies on, not the one the
Treasurer saw.

**Consequence:** an approval can fail for a payout that was entirely valid when
initiated. The refusal states which fact changed (REQ-66, REQ-67) rather than
repeating the original assessment, since that is what the Chairperson needs to
act on.

---

## 23. A payout record is a frozen decision, not a status field

The ledger (migration 006) and the constitution (migration 010) are both
protected against being altered after the fact. A payout carries the same risk:
REQ-68 requires the initiating user, the approving user, both timestamps and
the rule applied to be recorded, and REQ-64 requires that dual authorisation
hold no matter who touches the row afterwards.

**Delivered:** migration 011's `payout_guard()` trigger. A payout may move from
`Initiated` to `Approved` or to `Cancelled` and no further. Every column that
describes what was initiated (the recipient, the amount, the cycle, the rule,
the initiator) is frozen the moment it is approved. Deletion is refused
outright; a payout that should not proceed is cancelled (REQ-70), and the
cancellation is itself the record, the same principle as a reversing ledger
entry (REQ-91).

**Also enforced at the database, not only in the service:** the
`payout_two_people` constraint (REQ-64) and the `payout_one_open_rotation` and
`payout_one_per_cycle` unique indexes, which stop two payouts being raised
against the same cycle or two rotation payouts being open on the same club at
once, whatever order two requests arrive in.

---

## 24. The payout queue has no table of its own

REQ-71 requires an ordered queue; REQ-76 requires it to be recomputed on
membership changes while preserving everyone else's relative order.

**Delivered:** the order lives entirely in `member.queue_position`, where
migration 004 and the existing seed already kept it (`nextQueuePosition` for a
new member, REQ-42). No new `queue` table was added. `queue.service.js` reads
the order, applies a rule from `rules/queue.js` (a pure function operating on
plain arrays), and writes the new positions back inside one locked
transaction.

**Why not a separate table:** REQ-76's own wording is the reason — "preserve
the relative order of all members not affected by the event." A second
structure recording the order alongside `queue_position` is a second place
that order could live, and the two could disagree the same way a stored pool
balance could disagree with the ledger (decision 2). One column, one
transaction, one lock.

**What was added:** a uniqueness constraint on `(club_id, queue_position)`,
deferred to the end of the transaction, since it did not exist before and two
members could previously have held the same position. `queue_swap` and
`queue_arrears_decision` are new tables, because an exchange request and an
arrears ruling are not positions, they are the process that leads to changing
one.

---

## 25. An exchange of positions is one row that accumulates its own history

REQ-74 and REQ-75 describe a sequence: a request, the other member's consent,
the Chairperson's approval, only then the exchange. Each step can also end the
process without the next one happening.

**Delivered:** `queue_swap` is one row per request, moving through a status
(`Pending consent` -> `Pending approval` -> `Effected`, or `Declined`,
`Rejected`, `Cancelled`), rather than a sequence of separate event rows. The
`swap_effected_needs_both` constraint states REQ-75 at the database as well as
in the service: a row cannot reach `Effected` without both `consent_given` and
a Chairperson decision recorded, whatever writes the row.

**A member may be party to at most one open exchange at a time,** in either
role, enforced by two partial unique indexes. Without it, a member with two
requests in flight could have their position moved by whichever is approved
second, silently invalidating the first.

**Cancelling a payout that is waiting for approval frees the club for other
queue changes; a swap does the reverse.** `approveSwap` refuses while a payout
is `Initiated` (`queue.service.js`), because REQ-73 moves the recipient to the
end of the queue on posting — changing the order underneath a payout that is
already relying on it would let the two operations disagree about who is
where.

---

## 26. Interest earned and administrative costs are recorded as they occur, as two new ledger entry types

REQ-80's formula needs both figures. Nothing built before this sprint produces
either: there is no field, table or entry type anywhere that captures interest
credited to the club's funds or a cost of running it.

**Delivered:** two additions to `ledger_entry_type` (migration 012),
`'Interest'` and `'Expense'`, posted at the club level (`member_id` is
already nullable, unlike a Contribution or Penalty which belong to one
member) through the existing `appendEntry()`, the same function every other
entry type already goes through. `distributions.service.js` exposes this as
`recordInterest()` and `recordExpense()`, Treasurer-only, each requiring an
amount and a description, the same shape as recording a penalty.

**Why not compute interest automatically from a bank feed or a rate:** no
such integration or rate is specified anywhere, and inventing one (a fixed
annual percentage, say) would silently determine a real number nobody agreed
to. Recording it as it is told to the system, the same way a contribution
is recorded as it is told to the system, keeps the number as an input the
Treasurer is accountable for, not a formula the software invented.

**Consequence:** a club with no interest and no costs distributes correctly
with both figures at zero; the formula does not depend on either being
non-zero.

---

## 27. "Proportionate" means proportionate to a member's own net contribution for the period

REQ-80 requires interest and administrative costs to be shared out
"proportionately" but does not say proportionate to what.

**Delivered:** each member's weight is their own captured contributions less
their own unwaived penalties for the period, floored at zero
(`rules/distributions.js` -> `computeShares`). A member who put more into the
pool carries a larger share of what it earned and a larger share of what it
cost to run.

**Alternative considered and rejected:** an equal split among all members,
regardless of contribution. Rejected because a stokvel's constitution
(REQ-21, `contribution_amount`) already treats members as contributing
possibly-unequal amounts is not assumed elsewhere in the system, but nothing
prevents a future constitution amendment from doing so, and a share of what
the members' own money earned should track what each of them put in, not a
headcount.

**A member whose penalties exceed their contributions is floored at zero
for this purpose,** not given a negative weight: a negative weight would
mean the *more* a member owes, the *more* of the interest and costs they are
asked to carry, which inverts the intent of "proportionate to contribution."

---

## 28. A distribution covers current members only; an exited member is settled separately

REQ-80 does not say whether a member who left partway through the year is
owed anything at year-end.

**Delivered:** `distributions.repo.js` -> `periodMemberTotals` excludes any
member whose standing is `Exited`. Their contributions during the period
remain part of the pool being divided, so the remaining members' shares are
larger by that amount, the same way a genuinely unclaimed sum would be.

**Why:** `payout_type` already lists `'Exit settlement'` as a distinct kind of
payout (migration 011, following SDD 5.2.3), which is the mechanism REQ-26's
exit notice period exists to lead to. That mechanism is not built this sprint.
Paying an exited member again here, once it is, would be a double payment for
the same departure. Excluding them now and building the exit-settlement path
separately keeps the two from overlapping.

---

## 29. A member whose computed share would be negative refuses the whole distribution

Weighting at zero (decision 27) keeps a heavily-penalised member from
carrying other members' costs. It does not, by itself, stop their OWN base
figure (their own captured contributions less their own penalties) from
being negative before interest and costs are even added.

**Delivered:** `rules/distributions.js` -> `assessDistribution` refuses the
distribution outright, naming the member, if any computed final share is
negative, rather than paying them nothing and quietly folding their shortfall
into everyone else's shares.

**Why refuse rather than clamp to zero:** clamping a negative share to zero
without redistributing the shortfall would break REQ-81 — the shares would
no longer sum to the pool. Redistributing it invents a rule ("their debt is
shared by everyone else") that is stated nowhere. Refusing and naming the
member gives the Treasurer and Chairperson the choice explicitly: waive the
penalty (REQ-63, not yet built), recover it before distributing, or exclude
that member from this year's distribution by resolving their standing first.
This is the same posture as REQ-77's arrears ruling: a case the constitution
does not resolve on its own is handed to a human, not decided silently.

---

## 30. Dependant registration (REQ-37) is built inside the claims module, not its own

REQ-37 (recording a club's covered dependants) was not itself part of this
sprint's assigned scope (Rules Engine, Payout Engine, Rotating queue). It is a
hard prerequisite for REQ-83 to REQ-88 regardless: a claim cannot be assessed
against a dependant that the system has no way to record. Before this,
dependant rows existed only via `db/seed.js` inserting them directly.

**Delivered:** `registerDependant()` and `removeDependant()` in
`modules/claims/claims.service.js`, not a separate `modules/dependants/`. A
member manages their own; a Secretary, Treasurer or Chairperson may manage
any member's, the same reasoning as officers handling paperwork on a
member's behalf elsewhere in the system.

**Why not its own module, against the one-module-per-feature convention:** a
dependant has no purpose in this system other than being the subject of a
future claim (migration 004's own comment: "a dependant is a person whose
death TRIGGERS a claim"). Splitting it into a fourth module for two small
functions seemed like more ceremony than the feature warrants. If dependants
grow their own concerns later (photos, ID documents, a review workflow),
splitting them out is a mechanical refactor, not a redesign.

**Not built:** REQ-36, a member's own nominated beneficiaries by percentage
share. That governs who is paid when a MEMBER dies, a different, unbuilt
mechanism from a claim on a dependant's death, where REQ-83 already names the
claimant as the recipient.

---

## 31. REQ-87's waiting period is measured against the lodgement date, not the date of death

REQ-87: "a waiting period... between the admission of a member and the first
date on which a claim may be lodged." Two readings are possible: the period
blocks LODGING (a claim cannot be submitted until the date has passed,
whenever the death occurred), or it blocks COVERAGE (a death occurring inside
the window is never payable, even if the claim is lodged later).

**Delivered:** the first reading, matching the requirement's own words
("the first date on which a claim may be lodged"). `assessLodgement` compares
today (the lodgement date) against the member's join date plus the waiting
period, not the date of death against that figure.

**Consequence:** a member who joined during the waiting period, whose
dependant then died within it, cannot lodge immediately, but CAN once the
period has elapsed — the death itself is not disqualified, only the timing of
lodging it. If a stricter reading (the death itself must fall outside the
waiting period) was intended, this is a one-line change from comparing
`today` to comparing `dateOfDeath` in `rules/claims.js`.

---

## 32. A claim's own record is separate from its payout, and only one payment moves at a time

A claim can fail for reasons that have nothing to do with money (REQ-84,
REQ-85, REQ-87) before a payout is ever worth considering, and REQ-88
requires claims to be paid in the order they were lodged, which a rotation
payout or a distribution never had to enforce.

**Delivered:** `burial_claim` (migration 013) has its own four-state
lifecycle (Lodged, Initiated, Approved, Cancelled), separate from `payout`'s.
Lodging performs REQ-84, REQ-85 and REQ-87's checks and, if they pass, freezes
REQ-86's benefit amount immediately — before any Treasurer has looked at the
pool. Only once Lodged does a claim become something `initiateClaimPayment()`
can act on, which is where REQ-88 applies.

**REQ-88's ordering is enforced by allowing only one claim payment "in
flight" at a time** (`claim_one_open_per_club`, the same shape as
`payout_one_open_rotation` and `distribution_one_open_per_club`), plus a
service-level check that the claim being initiated is the oldest still-Lodged
one. A later, smaller claim cannot be paid ahead of an earlier, larger one
even if the pool could cover it — BR-12 is explicit that the shortfall is
presented for resolution, not routed around.

**A cancelled claim's dependant can be claimed again** (the uniqueness
constraint on `burial_claim.dependant_id` excludes `Cancelled` rows), so an
insufficient-pool refusal is not the end of the matter: the Treasurer can
cancel and re-lodge once the pool recovers, the same recovery path a
cancelled payout or distribution already has.

---

## 33. Waiving a penalty reverses the full original amount, regardless of settled_amount

REQ-63 says a waiver posts "a reversing entry rather than deleting the
original penalty." What it does not say is how a waiver interacts with
`penalty.settled_amount`, an existing field the original team built so that
an excess payment can pay down a penalty over time (`applyExcess`,
`contributions.service.js`) without posting a second ledger entry for it.

**Delivered:** `waivePenalty()` reverses the FULL amount of the original
`Penalty` ledger entry, unconditionally. `settled_amount` is left exactly as
it is.

**Why:** the cash that ever actually moved for this penalty is the single
entry posted when it was levied (REQ-56). `settled_amount` does not
correspond to a second movement of money — it is a bookkeeping marker for
when a member's arrears are considered cleared, updated by
`applyExcess` without a ledger entry of its own. Reversing "what is left
outstanding" rather than "what was originally levied" would need a second
source of truth for an amount that the ledger itself never split in two.

**A real edge case this does not resolve:** if a penalty was already fully or
partly settled by an excess payment before being waived, waiving it still
reverses the whole original amount. The member's earlier excess payment
already reduced what they owed elsewhere; the waiver now also gives back
the full penalty. Whether that is double relief or is exactly the
Chairperson's intent depends on the case — REQ-63 does not say waiving is
refused or reduced when a penalty is partly settled, so this implementation
does not invent a restriction. Worth a second opinion before relying on it
for a penalty that has already been part-settled.

---

## 34. Officer role caps: added at the club's request, not from the SRS — and deliberately narrower than what was first asked for

The club asked for three related rules: (1) officer counts that scale with
club size, (2) a Chairperson-led club creation flow requiring Platform
Administrator approval, (3) a rule that a Treasurer, Chairperson or Secretary
of one club may only be an ordinary Member of any other. Only (1) is built.

**(2) and (3) were not built because they contradict requirements already in
the SRS, already implemented, and already covered by tests:**

- REQ-18: *"The system shall permit only the Platform Administrator to
  create a club."* Reversing this to let a Chairperson create their own club
  is a deliberate change to a graded requirement, not a gap-fill. It was
  flagged back to the club rather than built silently.
- REQ-10: *"The system shall permit a user to hold different roles in
  different clubs."* The seed data's own flagship scenario (Nomsa Maluleke,
  Treasurer of one club and an ordinary member of another) exists specifically
  to demonstrate this. A cross-club exclusivity rule would need that scenario
  rewritten, not just a new check added.

Both are one-line rule changes if the club decides, after discussion, that
their SRS should actually say something different — but that is a decision
for the group to make together, not one an AI assistant should make by
quietly overriding a requirement someone else wrote.

**(1) has no such conflict, so it was built.** The thresholds:

| Role | Cap |
|---|---|
| Chairperson | exactly 1, always |
| Treasurer | 1 + one more per 100 active members |
| Secretary | 1 + one more per 150 active members |

**Chairperson at exactly one is not arbitrary:** BR-2's dual authorisation
(a payout, distribution or claim needs a different account to approve it)
depends on there being one Chairperson whose approval means something
specific. A second Chairperson would not break anything mechanically, but it
muddies who "the other account" actually is.

**Treasurer and Secretary's numbers are a judgement call the club asked for
directly** ("think of any logical allocation" for Secretary). Treasurer
scales with headcount because that role's work (capturing contributions,
initiating payouts) genuinely grows with membership. Secretary's work
(minutes, announcements, membership records) does not scale with headcount
in the same way — tying it to headcount anyway, at a looser ratio, was
offered as the simpler of two options discussed and is easier to defend to a
marker than a governance-activity metric that does not exist yet. Both
numbers live in exactly one place (`rules/officers.js` -> `maxHoldersFor`)
and are not copied anywhere else, so revising them later is a one-function
change.

**Not enforced at the database.** Unlike money-integrity rules (the ledger,
a payout, a distribution, a claim), nothing here is a financial record that
must never quietly change; it is a convenience constraint on assigning roles.
Consistent with how contribution-amount and cycle-open validation are also
service-layer only, this was left there rather than added as a
counting-trigger, which would be considerably more machinery for a rule that
is not protecting money or an audit trail.

---

## 35. Proof-of-payment files are stored as bytes in the database, not in object storage

`contribution.proof_url` (migration 005) was written with the comment "SDD
5.3: object storage reference": the original design assumed the file would
live in something like S3 and only its address would be kept here. The
project has no such service, and no budget for one.

**Delivered:** the file is stored as `BYTEA` in a new `proof_of_payment`
table (migration 015), one row per contribution. `proof_url` is still set, to
this API's own download route (`/api/contributions/:id/proof/file`), so the
column keeps the meaning its comment gave it, "where to fetch the file
from", rather than being left null next to a second, unrelated mechanism.

**Why this is acceptable here:** REQ-53's own limits (5 MB, JPEG, PNG or PDF
only) keep any one file small and bounded, and the table is written to by
one officer role, not by every member. It would stop being acceptable at
volume: a club uploading a receipt for every contribution for years would
grow the database's size, backup time and memory use in a way object storage
would not. Moving to object storage later means changing `upsertProof` and
`getProofFile` in `contributions.repo.js` and nothing above them.

**Replacement, not accumulation:** a second upload for the same contribution
replaces the first (`UNIQUE` on `contribution_id`). A Treasurer needs to be
able to swap a blurry photo for a clear one. The proof is supporting
evidence, not a financial record, so it is deliberately not made immutable
the way the ledger, a payout or a claim is.

**Held in memory, never on disk:** `multer` is configured with
`memoryStorage`, so an upload exists only for the length of the request and
there is no temp file to clean up.

---

## 36. Governance freezes attendance and the constitutional rules used for a vote

**Historical implementation note:** the assumed majorities and single-class model
below are superseded by decision 37 and migration 017. They describe the first
handoff, not the current voting workflow.

REQ-104 to REQ-109 and REQ-32 are implemented by migration 016, the governance
module and `/governance`. A Secretary or Chairperson records a completed meeting;
only the Chairperson submits constitutional amendments and gives carried decisions
effect. Club members can read meeting records. Platform administrators cannot.
Attendance is unique, club-scoped and checked against join/exit dates. Suspended
and in-arrears memberships remain part of the active membership denominator;
Exited/Expelled memberships without an exit date cannot be reconstructed safely
and are excluded. The eligible count, attendees, quorum count and constitution
version are frozen at recording time; later changes do not rewrite that meeting.
Historical role/standing changes without dates are not reconstructed.

Quorum rounds up. Every attendee must be accounted for in the vote totals,
including abstentions. A non-quorate meeting always produces advisory resolutions;
they can be recorded but never applied. General and expulsion motions require
more than half of everyone present to vote in favour; ties fail and abstentions
cannot manufacture a majority. Meeting, attendance and resolution records are
immutable, apart from the one-time application marker on a carried resolution.
Correct errors by recording a new, explicitly corrective record.

**Unspecified amendment threshold:** REQ-109 refers to a constitutional majority
but neither the supplied SRS nor the previous schema specifies a value or distinct
amendment classes. This implementation treats supported parameter amendments as
one class and adds `amendment_majority_percentage` to each constitution version.
The conservative initial value is 100% of attendees (unanimity), not an invented
simple majority. A carried amendment can change it to a whole percentage from
51 to 100. The existing threshold governs the vote that changes the threshold.
The UI displays the meeting's version and required percentage. The group should
confirm this default against the actual club constitutions; additional amendment
classes would need explicit requirements.

A resolution stores the exact changes and effective date voted on. Applying it
calls `createNewVersion()` inside the same transaction as the application marker.
A second application, stale constitution baseline or effective date in the past
is refused. An intervening amendment needs a fresh resolution, never silent
rebasing of the members' vote. Existing contribution-cycle selection issues in
T2 remain separate and are not claimed fixed by this governance work.

Expulsion needs a carried resolution, preserves membership/ledger history, records
the exit date and closes the queue gap in one transaction. It refuses to remove
the last Chairperson or Treasurer until a replacement exists (REQ-49). Expelled
members cannot switch back into the club or retain permissions through an existing
session. Defaulter thresholds and automatic stage advancement remain T7, assigned
separately; governance does not invent those thresholds.

`npm run test:governance` runs the migrations and real services/HTTP middleware in
an isolated PGlite PostgreSQL engine. It needs no credentials and never connects
to, truncates or rebuilds the shared Supabase database. It proves transaction
rollback, constraints, tenant isolation, role checks and expulsion behaviour.
It does not claim to test distributed concurrency or Supabase network behaviour.


---

## 37. Confirmed voting rules, pending proposals and officer succession

This completes the T5 workflow against REQ-32 and REQ-104–109. The annual report
in REQ-110 is also implemented. Notifications, the automatic defaulter pipeline
and reconciliation capture remain with their assigned developers.

**No invented majority.** The SRS refers to a majority for each amendment class
but does not specify those classes, numbers, denominators or voting rights.
The Chairperson records the rules already adopted in the club's constitution,
with a source clause, effective date and explicit attestation. This one-time
capture is immutable and audited. It is not permission to invent or change rules.
If no adopted rules exist, the group/club must settle them before using binding
governance; the application does not silently use 100% or a simple majority.
The old `amendment_majority_percentage` column remains solely for compatibility;
new decisions use the confirmed policy snapshot instead.

The recorded policy specifies the General and Expulsion rules, the names and
field coverage of amendment classes, and voting rights for suspended and in-arrears
members. Parameters are limited to the actual club type. Each applicable parameter
belongs to exactly one class. Fractions are exact: at least 2/3 of three voters
means two votes, while more than 2/3 means three. The policy specifies whether the
denominator is eligible attendees, votes cast excluding abstentions, or the full
eligible electorate. An amendment spanning classes must satisfy all their rules.
Quorum continues to use active membership as REQ-25 specifies; voting entitlement
is recorded separately. Every eligible attendee is counted once in the tally.
Future policy changes themselves require a proposal and a carried resolution under
the existing policy; an officer cannot lower the threshold before voting.

**Pending stage.** The Chairperson submits an immutable proposal before its vote.
Submitting does not create a constitution version. A Secretary or Chairperson
records the vote against that exact proposal at a meeting governed by the same
version. Advisory votes leave it pending; rejection is a binding outcome requiring
a new proposal to try again. A carried proposal can be applied once. The proposal's
text, parameter values and effective date cannot be replaced when recording votes
or applying them. Stale baselines and expired effective dates require a new proposal.

**Succession.** An expulsion resolution can name an ordinary member in good standing
to replace the officer. That identity and the subject's role are frozen in the vote.
Application rechecks them, removes the expelled member from the queue, ends their
membership and transfers the office in one transaction. If no replacement is named
for the last Chairperson/Treasurer, recording/application is refused. Any failure
rolls the whole operation back. The Secretary can record this vote, but only the
Chairperson can apply it, consistent with the current permission model.

**Historical evidence.** Membership status/role changes are captured automatically
from migration 017 onward, including changes made by other modules. Meeting records
freeze the eligible roster, actual attendance, voter counts and policy. For a past
date, recorded member history at that South African day's end is used. Dates before
the available history are refused rather than reconstructed from today's standing.
Old meeting/resolution records remain readable. Unapplied legacy votes based on the
assumptions from decision 36 cannot be applied; use a new meeting under confirmed
rules. Already applied historical records are not rewritten.

## 38. Constitutional amendments govern new cycles by commencement

REQ-33 is now enforced for newly opened contribution cycles: an amendment is
selected only when its effective date is strictly before the cycle commencement.
The founding version can apply on its own effective date. Opening is permitted
only on or after commencement. Each new cycle pins the selected constitution ID,
which cannot later change; contribution amount, grace and penalty evaluation use
that pinned version. Opening takes the same club lock as constitutional amendments.

Migration 017 pins pre-existing cycles using the former due-date lookup, preserving
the version that the earlier application would read when the migration runs. It
never rebills them, changes captured money or guesses which version was originally
used if that information was never stored. Historical monetary discrepancies, if
any exist, need explicit ledger corrections, not an automatic rewrite.

Calendar dates in the contribution repository travel as text. Input dates are
validated, and grace expires at the end of the South African calendar day regardless
of the server timezone. The previous timezone-sensitive fixture now states +02:00
explicitly. Tests run under UTC, Africa/Johannesburg and America/Los_Angeles.

## 39. Annual report uses the ledger and labels incomplete reconciliation

REQ-110 is exposed as a read-only report on Governance for roles with `view.ledger`.
It includes opening and closing pool balances, net contributions, net penalties,
net payouts/claims, other net movements and membership movement. Reversals are
classified against their original entry, including corrections posted in a later
year. South African midnight defines calendar-year boundaries. Current-year reports
are explicitly year-to-date. Monetary values remain decimal strings/integer cents.
All report queries run in one SQL statement for one consistent snapshot.

The report reads the latest reconciliation on/before its cut-off and shows its
actual date. Missing records, a record older than the cut-off and a non-zero
difference are shown explicitly; it never assumes that a stale bank balance is a
year-end verification. Memberships with an ended standing but no exit date are
excluded from movement counts and disclosed as unverifiable. This read-only view
does not implement or modify the separately assigned reconciliation capture flow.

Validation: 254 unit tests; isolated PostgreSQL migration-upgrade, service and HTTP
checks; production build; browser checks for proposal, meeting, vote and application.
The isolated engine does not prove multi-instance concurrency or Supabase networking.


## 40. Complete the existing contributions and negotiated queue screens

30 September 2026. Implements remaining-work T3, using the existing permissions,
shared UI components and module structure. No migration or financial rule change.

Proof evidence (REQ-53) is attached only after a positive contribution has been
captured. The Treasurer may upload, replace or remove one file. Replacement and
removal ask for confirmation. JPEG/PNG/PDF, non-empty content and the existing 5 MB
limit are checked; server checks a matching file signature as well as declared MIME
(this is not a full document parser or malware scanner). Multipart errors return a
readable 400. Download responses use private/no-store caching, attachment filenames
and binary bytes; the authenticated frontend offers local View and Download links.

Proof read access previously accepted any member of the club. It now matches the
contribution register: Chairperson, Secretary and Treasurer can read the club's
records; ordinary members can read only their own. The new penalty register uses
that same visibility rule, with 50 rows per page and stable ordering. Only the
Chairperson can waive, still using the original waiver service and recorded reason;
the original penalty and immutable ledger history remain. This adds no general
ledger reversal operation and no defaulter processing.

The cycle selector uses the existing latest-24-cycle history API, including closed
cycles, so recent proof is accessible when no cycle is open. Older cycles remain
available by their existing API identifier; unlimited history browsing is not added.

For Negotiated order, the Chairperson gets the same active candidates used by the
existing establishment service, including suspended/in-arrears members as that
service already specifies. Up/Down controls support keyboard and touch. An explicit
checkbox confirms the club's agreed order; it is a UI acknowledgement, not a new
voting resolution requirement. The existing server rejects missing, duplicate,
foreign or stale membership lists. Eligibility for actual payout remains separate.
Random draw and Seniority retain their existing establishment behaviour.

Isolated authenticated HTTP tests are committed in `server/integration/screens.js`.
They cover file bytes, replacement/removal, limits, captured-only enforcement,
role/owner/tenant restrictions, penalty paging/waiver/reversal, and negotiated-order
validation. Run with `node server/integration/screens.js`; no external database is
used. Existing governance tests remain separate and unchanged.

A remaining test timestamp in the no-grace boundary fixture now explicitly uses
+02:00. Its previous timezone-free string meant a different instant on hosts east
of South Africa. Production date and penalty rules are unchanged in this update.

Excluded by assignment: REQ-3, REQ-11, REQ-58, REQ-100, REQ-101–103, notifications,
and Reconciliation (Use Case 5). No code for those features is introduced here.


## 41. Consistent South African date handling

30 September 2026. PostgreSQL DATE parsing now preserves YYYY-MM-DD text, and
connections request Africa/Johannesburg as their SQL session timezone. Timestamps
remain instants. This also aligns CURRENT_DATE defaults and date comparisons with
the club's South African day. Report/distribution timestamp boundaries explicitly
use Africa/Johannesburg. No old records are re-dated.

Browser formatters preserve date-only values and display timestamps in South African
time, independently of the device timezone. Contribution, member, claim and platform
form defaults use the South African day. Member join dates and platform dates reject
impossible calendar input. Catch-up compares calendar strings and takes the amount
from the open cycle's pinned constitution, preserving REQ-33's cycle boundary.

Evidence: date-display unit checks in UTC, South Africa, Los Angeles and Kolkata;
DATE parser, SA midnight and API calendar-date checks in ledger-reversals integration.
The configured deployment's PostgreSQL/proxy connection should also be checked with
its normal configuration; the automated database checks use an isolated engine.

## 42. General ledger corrections and payout reversal approval

30 September 2026. Migration 018 introduces immutable reversal requests and database
guards on new reversals. Treasurer posts a correction of equal and opposite amount,
linked to the original, with a reason. A payout (including distribution and burial
payouts, plus the legacy Claim entry type) needs a recorded Chairperson decision
first. Approval changes no money: a Treasurer subsequently posts the exact approved
request. A requester cannot approve their own request; an approver cannot post it.
Rejected requests remain visible and can be followed by a new request. Posted
requests are final. Duplicate reversals and reversals of reversals are refused.

Posting locks the club and commits the request update and ledger entry together.
The database checks equal/opposite amounts, matching club/member/source identifiers,
reason and prior payout approval. Existing ledger entries are never changed.
Service auditing records success/refusal; API permissions remain authoritative.

DOCUMENT CONFLICT: REQ-63 explicitly gives penalty waiver to the Chairperson and
requires a reversing entry. REQ-92 says only Treasurer posts reversing entries.
We preserve the already-implemented REQ-63 exception: the general ledger action
refers penalties to the dedicated waiver flow so the penalty flag and ledger stay
consistent. The group should record this exception explicitly in the SRS.

SCOPE: correcting a ledger entry does not mean undoing a business process. This
implementation does not reconstruct contribution allocations/credits, rewind a
rotating queue or reopen approved claims/payouts. Those operations need separate
compensation rules and source allocation history. The screen states this boundary;
do not claim that reversal cancels the original process. Ledger/pool and annual
report totals incorporate reversals; source-based contribution/distribution inputs
are not automatically restated by this operation. Review this boundary before
using ledger corrections to fix incorrectly captured operational data.

Evidence: isolated real HTTP/database tests in `server/integration/ledger-reversals.js`
cover permissions, pending/approval/posting, unchanged balance at approval, exact
opposing amounts, rejection/retry, database guards, history immutability, duplicate
and tenant refusals, and rollback after insertion. Existing governance and screen
integration tests also pass. No shared database was migrated or branch pushed.


## Decision 43 — Membership completion and dashboard evidence (30 September 2026)

REQ-36 uses integer hundredths of a percentage, not a floating-point tolerance.
Replacement of the member's nominations is one club-locked transaction. All club
roles may nominate their own beneficiaries; platform administrators may not.

REQ-129–135 announcements are immutable records. Corrections are new records with
a same-club foreign key and are displayed alongside the original. Paging is newest
first. Chairperson/Secretary may publish. REQ-132 channel dispatch remains with the
notification owner; reading announcement rows is the integration boundary, not a
claim that messages have been delivered.

Exit rules are free text, not an executable policy. Chairperson may record an
immutable mapping ONLY when its calculation exactly represents the adopted rule.
The supported sequence is: selected-period contribution ledger receipts minus prior
payouts if selected (floor zero), unpaid penalties if selected, proportionate costs
if selected, then percentage forfeiture. Costs use the member's net contribution
share of club net contributions in that period. Fractional cents are rounded DOWN;
deductions never exceed remaining gross entitlement. Negative net period inputs
require review. Periods are membership, notice calendar year or constitution cycle
start. Rules with other conditions, paid-penalty deductions, another rounding rule,
or another cost-sharing basis are unsupported. In particular, the seed's
"before completing one full rotation" condition is NOT represented by selecting 10%.
Do not attest to a partial mapping. A mapping correction requires a new adopted
constitution version; previous notices retain their version and calculation evidence.

REQ-45–46: notice submission records an initial calculation. A Treasurer refreshes
it for approval; a different current Chairperson approves, after the notice period.
Approval recomputes inputs and refuses stale assessments. Repayment, retained
forfeiture evidence, deduction settlement, queue removal and exit history commit
atomically. An approved Exit settlement payout provides two-account evidence for
positive repayments. Zero repayment creates no zero-valued payout, but still records
forfeiture evidence. Penalty deductions increase settled_amount, without posting
another receipt. The member and prior transactions are retained. Last-officer,
queue-head arrears, pending payout and insufficient-pool safeguards apply.

ACCOUNTING DECISION REQUIRING GROUP REVIEW: forfeiture retains existing money; it
is recorded as a zero-value Adjustment with the retained amount in its description
and the immutable assessment. Posting a positive forfeiture receipt would count the
same cash twice. The SRS does not specify a separate forfeiture ledger category.
The implementation records it only at approval without changing cash twice.

HISTORICAL GAP (resolved by decision 44 and migration 020 below): REQ-47 also allows express write-off by resolution. That alternative
is NOT implemented. The existing General resolution text cannot safely authorise a
specific member/debt amount. A future structured resolution and obligation allocation
must agree with the contribution/defaulter module; do not fabricate a cash capture to
clear debt. Until then the queue head with arrears cannot exit.

EXISTING LEDGER BOUNDARY: contribution ledger receipts include excess payments and
credits; source allocations are not reconstructed after reversals (decision 42).
Settlement policy mapping does not repair that history. Cases requiring separation
of paid penalties, credits or reversed allocations need accounting review before
approval. No arbitrary interpretation of a free-text constitution is supplied.

REQ-111–118: financial dashboard indicators are calculated from exactly the rows
returned in their expandable detail. Multiple reads run in a READ ONLY REPEATABLE
READ transaction. Member responses contain only that member's detailed finances;
Treasurer/Chairperson see club financial records. Queue projection reuses queue.service.
The 12-month series uses the previous 12 COMPLETED SA calendar months, while current
month cards cover the current month. Reversals retain the original entry category.
No reconciliation is represented as "Not recorded", not a falsely balanced result.
Missing defaulter stages are explicitly labelled unavailable, not zero.

DOCUMENT CONFLICT: REQ-112 describes penalties among expenses, but the current
ledger posts penalty assessments positively (and cash collection is recorded as
Contribution). The dashboard follows those existing ledger signs and displays
penalty entries separately. It is a ledger movement report, not a newly certified
cash-flow statement. The group must reconcile terminology and accounting rules.

Verification: 261 unit tests; isolated authenticated HTTP/database integration for
beneficiaries, announcements, exit settlement, stale assessment, insufficient funds,
last officer, queue-head safeguards and dashboard privacy. Existing governance,
screens and reversal integration suites passed; production build and imports passed.
Interactive browser verification was unavailable: the browser executable was missing
and its download failed. The supplied manual walkthrough remains an acceptance task.


## Decision 44 — Exact debt write-off and platform aggregate detail (1 October 2026)

This supersedes decision 43's outstanding REQ-47 gap and its platform drill-through
limitation. A Chairperson/Secretary can record a General resolution whose immutable
payload identifies an exit notice, member, every affected contribution, expected
amount, captured amount, prior written-off amount and exact debt total. The source
rows must match the snapshot displayed before submission. The existing constitution's
General voting rule and meeting quorum determine the result; no new majority is
invented. The resolution text explicitly states the amount, member and notice.

Because captured contribution history does not reconstruct arbitrary past balances,
these snapshot votes must be recorded ON the meeting date in South African time.
A backdated debt vote is refused instead of using today's debt as past evidence.
If the club constitution specifies a special debt-write-off majority, this General-rule
workflow must not be used until that separate rule is supported. Do not change the
General majority merely to fit one debt clause.

A carried resolution does not independently forgive debt. It is consumed only in
the matching exit approval transaction, after Treasurer assessment, notice-period,
last-officer and funding checks. Debts must still match every recorded amount. Any
payment, new obligation or cancelled/replaced notice invalidates the old snapshot;
a fresh vote is needed. Advisory, rejected, applied and wrong-member resolutions are
refused. This completes REQ-47's settle-or-expressly-write-off alternatives.

Contribution.expected_amount and captured_amount are preserved. A separate immutable
contribution_writeoff allocation and written_off_amount record forgiven debt. Net
outstanding is greatest(expected_amount - captured_amount - written_off_amount, 0).
The cash ledger receives a ZERO Adjustment describing the debt and resolution; it
receives no invented Contribution or Expense. Exit approval, resolution application,
allocations, repayment and Exited status commit together. A deferred database guard
refuses allocations without the matching approved exit. Source money cannot be
rewritten after write-off, and new captures for ended memberships are refused.

Integration handoff: the defaulter and batch-capture owners must use the net
outstanding formula and skip Exited/Expelled memberships. They retain ownership of
those modules. Existing statement/member/payout/dashboard/club-selection balance
queries are updated. Assistant code has ONLY the same outstanding-balance SQL change;
no assistant behaviour, prompts or feature implementation has been replaced.

Platform detail remains aggregate under REQ-19/20. Its member count is the sum of
non-ended standing buckets, and its funds figure is the sum of platform-wide ledger
category totals (including reversals in their original category). The same returned
rows power the figures and their expandable details. Club names/statuses remain
visible for administration; club/member financial records are never returned. A
read-only repeatable-read transaction keeps stats and club list consistent.

Evidence: new authenticated HTTP/isolated-database tests cover exact snapshot votes,
advisory/rejected/wrong-member/stale refusals, failure AFTER write-off allocation with
full rollback, final cash balance, preserved original source money, blocked recapture,
immutable allocations and platform aggregate/privacy boundaries. Existing governance,
screens, reversal and completion suites pass. Browser acceptance remains manual.

## Decision 45 — Standing engine driven by constitution thresholds (1 October 2026)

Implements REQ-44 and REQ-101 to REQ-103 (T7). A member's standing now changes
automatically from thresholds, counted in missed contributions, that the
constitution carries. The engine moves one step per run (Good standing, then In
arrears, then Suspended) so that every stage is recorded. A member returns to
Good standing once arrears and unwaived penalties are both cleared.

The warning stage maps to the existing In arrears standing instead of a new enum
value. The member_standing enum (migration 004) is not altered.

The three thresholds are new nullable columns on constitution (migration 021).
Migration 010 forbids editing a recorded version, so a club sets them by recording
an amendment. They must be given all together or not at all, and strictly
increasing, which is enforced by a database CHECK and by validateConsistency.
Every existing version holds NULL, and a club whose version in force has no
thresholds is left unchanged.

The engine never expels. Expelled is reached only through the governance
expulsion resolution (decisions 36 and 37), which also preserves history, closes
the queue gap and handles officer succession. The engine's own call is one step
short of that stage.

A contribution counts as missed once its cycle's grace period has ended, using
the net outstanding formula from decision 44. Exited and Expelled memberships are
skipped. Every change is written to the append-only standing_change table with
its date and the acting user (empty when the engine acted on its own).