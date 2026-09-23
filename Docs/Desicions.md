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