# Decision log

Each entry records what was decided, what else was on the table, and why. This is
the raw material for the design chapter of the report.

## D1 — Dark chrome, light content

**Decided:** navy navigation and headers, light content surfaces.
**Alternatives:** fully dark, fully light.
**Why:** statements are printed (§3.2 requires print stylesheets); members read
balances outdoors on inexpensive screens; long columns of numbers are more
legible on light. A dark shell still gives the product its weight.

## D2 — Rotating payout as the first end-to-end workflow

**Decided:** build the payout path first, contributions second.
**Why:** it is the only workflow that visibly exercises the rules engine, the only
one requiring two people, and it cannot be built without the ledger, so it drags
the system's spine into existence early. Contribution capture is higher-frequency
but visually indistinguishable from any competent data-entry table.

## D3 — Sixteen screens finished rather than thirty-two adequate

**Decided:** depth over breadth.
**Deferred:** meetings and resolutions, defaulter pipeline detail, announcements
composition, year-end distribution, exit settlement, constitutional amendment,
the AI assistant.
**Why:** a reviewer poking at an unfinished screen learns less than one exploring
a finished journey. The deferred screens are designed, and design is what the
report needs; building them adds no argument.

## D4 — The rules engine is real, not mocked

**Decided:** `lib/rules/` holds pure functions with no React and no data access.
**Why:** §5.4 requires the engine to be exercisable independently of the
interface and §6.4 requires it to be reusable. Building it properly means every
refusal in the demo is a genuine ruling rather than a scripted message, and the
module survives into production untouched.

## D5 — All reads and writes through `lib/data.js`

**Decided:** components never touch the store; they call selectors.
**Why:** the mock adapter is replaced by a Supabase adapter without changing a
line above that boundary. It also gives the prototype a single place where the
tenancy filter is applied, mirroring SDD 4.1.

## D6 — Red is reserved for exceptions

**Decided:** money leaving the pool renders in neutral ink with a minus sign. Red
appears only where a human must act.
**Why:** if red means "outflow", it cannot also mean "attention", and a payout is
a normal, correct event. Every status also carries an icon and a word, so nothing
depends on colour alone.

## D7 — No edit or delete affordance on financial rows

**Decided:** correction is by reversal, and the ledger screen says why.
**Why:** BR-3. Most admin interfaces put a pencil icon on every row by reflex.
Removing it is the clearest signal in the whole product that the designers
understood the domain.

## D8 — Role-adaptive navigation

**Decided:** a Member sees four navigation items; a Treasurer sees nine.
**Alternative:** one navigation with forbidden items disabled.
**Why:** for the least technical user class, a menu full of doors that do not open
is worse than a short menu. Within a screen the opposite holds: a disabled action
with a stated reason teaches the governance model, so those stay visible.

## D9 — A visible demo control for switching account

**Decided:** an amber control in the header, styled as a demo affordance.
**Why:** dual authorisation needs two people and a live demonstration cannot log
in twice. Making it obviously not product chrome keeps the prototype honest.

## D10 — Print stylesheet instead of a PDF pipeline

**Decided:** REQ-100 satisfied for now by browser print output.
**Why:** it produces a genuinely usable document at almost no cost. A
server-rendered PDF and a delimited export belong to production.

---

# Gaps and conflicts found in the SRS

These are holes in the specification, not implementation shortcuts. Each needs a
group or client decision before production.

1. **REQ-64 conflicts with REQ-46.** REQ-64 requires *every* payout to be
   treasurer-initiated and chairperson-approved. REQ-46 requires only chairperson
   approval for an exit settlement, which `Payout` classifies as a payout type.
   Which governs?
2. **REQ-80 has no source for its inputs.** A distribution share depends on
   "interest earned" and "administrative costs", but no requirement captures
   either. The prototype seeds an interest entry to make the arithmetic possible.
3. **Catch-up obligation has no parameter.** REQ-41 computes it "according to the
   constitution", but `Constitution` holds no catch-up field. The prototype
   assumes one cycle's contribution and says so on screen.
4. **Cycle closure is unspecified.** REQ-59 refuses capture against a closed
   cycle, but nothing says who closes a cycle or when.
5. **Payout has no Refused state.** The set is Initiated, Approved, Cancelled,
   yet Use Case 4 requires a refused claim to be recorded with its reason. The
   prototype adds Refused to the claim rather than the payout.
6. **Next-cycle credit has no entity.** REQ-57 creates a credit, but no class
   represents it and `Contribution.status` cannot express it.
7. **No member self-registration.** REQ-43 restricts registration to the
   Secretary or Chairperson, so the login screen has no sign-up link. Confirm
   this is intended.
8. **Password reset is entirely unspecified.** REQ-6 covers lockout; nothing
   covers recovery.
9. **Currency format is ambiguous.** "Two decimals with a thousands separator"
   permits both R1 234,56 and R1,234.56. The prototype fixes on a space separator
   and a dot decimal in `lib/format.js`.
10. **Proof-of-payment visibility is unstated.** Uploads are captured but no
    requirement says who may view them.
11. **Offline behaviour is out of scope** (§2.4) while the primary user class is
    described as being on intermittent connections. Worth raising with the client
    as a known limitation rather than discovering it during evaluation.

---

# Fixed lexicon

The source documents drift between synonyms. The product does not.

**Use:** contribution · capture · cycle · pool · post / posted · reverse /
reversing entry · payout (rotation payout, year-end distribution, burial benefit,
exit settlement) · standing (members) · status (contributions and payouts) ·
constitution · officer · club

**Never:** deposit · payment · enter · record (as a verb for capture) · fund ·
edit · undo · disbursement · withdrawal · tenant · organisation · settings
