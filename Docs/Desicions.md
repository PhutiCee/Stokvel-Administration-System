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