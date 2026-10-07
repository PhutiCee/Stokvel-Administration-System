# Stokvel Administration System

Administration for rotating savings clubs, grocery stokvels and burial societies.

Group 5 · SCSC082 Software Engineering · Department of Computer Science,
University of Limpopo · 2026

Built to the approved Software Requirements Specification v1.0 and the Detailed
System Design Document.

---

## Architecture

Three tiers, as described in SDD section 4.

| Tier         | Technology                            | Directory        |
| ------------ | ------------------------------------- | ---------------- |
| Presentation | Next.js 14 (App Router), Tailwind CSS | `web/`           |
| Application  | Node.js, Express, REST API            | `server/`        |
| Data         | PostgreSQL 15 (hosted on Supabase)    | `server/src/db/` |

The two tiers run as separate processes and talk over HTTP. The web application
holds no database credentials and performs no data access of its own.

**Supabase is used as a PostgreSQL database and nothing else.** The Supabase
JavaScript SDK, PostgREST, Supabase Auth and Row Level Security are all
deliberately unused: authentication, authorisation and tenant isolation belong
in the application tier, which is where the design document places them. See
`docs/decisions.md`.

---

## Getting it running

You need Node.js 18.18 or later (Node.js 22 LTS recommended) and a Supabase project.

### 1. Install

```bash
git clone <your-repo-url>
cd stokvel-administration-system
npm install
```

npm workspaces installs both `server/` and `web/` from the root.

### 2. Configure the server

```bash
cp server/.env.example server/.env
```

Open `server/.env` and set `DATABASE_URL`. In Supabase go to
**Project Settings → Database → Connection string** and take the
**Session pooler** string:

```
postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres
```

Use the session pooler, not the direct connection. The direct connection
(`db.<ref>.supabase.co`) resolves over IPv6 only on the free tier, and on most
South African home and campus networks it will simply time out with no useful
error. The pooler answers on IPv4.

Use port 5432 (session mode), not 6543 (transaction mode). Express is a
long-running process with its own connection pool, which is what session mode is
for; transaction mode silently breaks prepared statements.

If your database password contains `@ : / ?`, percent-encode it.

To enable **Forgot password**, add a Brevo API key and a verified sender to
`server/.env`:

```dotenv
BREVO_API_KEY=your_brevo_api_key
MAIL_FROM=your_verified_sender@gmail.com
MAIL_FROM_NAME=Stokvel Ledger
WEB_ORIGIN=http://localhost:3000
```

In production, set `WEB_ORIGIN` to the public web-app URL. Accounts without a
registered email must ask their club secretary to update their contact details
or help them regain access. Password reset links expire after 30 minutes and
work once. The server stores only a hash of each link and signs out existing
sessions after a successful reset.

### 3. Configure the web application

```bash
cp web/.env.local.example web/.env.local
```

The default (`http://localhost:4000`) is correct for local development.

### 4. Create the schema and load the demonstration data

```bash
npm run migrate
npm run seed
```

The password recovery table is added by migration `032_password_recovery.sql`;
the normal migration command applies it without resetting existing data.

### 5. Run both tiers

```bash
npm run dev
```

- API — http://localhost:4000
- Web — http://localhost:3000

Or run them in separate terminals with `npm run dev:api` and `npm run dev:web`,
which is easier to read when something goes wrong.

---

## Signing in to the seeded system

Every seeded account uses the password in `SEED_PASSWORD` (`stokvel2026` by
default). The username is the phone number; spaces and a `+27` prefix are
accepted.

| Phone          | Person            | Holds                                                |
| -------------- | ----------------- | ---------------------------------------------------- |
| `082 441 7788` | Nomsa Maluleke    | Treasurer of Mmakau, **ordinary Member of Bokamoso** |
| `073 902 1145` | Thabo Mokoena     | Chairperson of Mmakau, Member of Lehumo              |
| `071 334 9026` | Refilwe Mahlangu  | Secretary of Mmakau                                  |
| `082 201 5566` | Grace Baloyi      | Chairperson of Bokamoso                              |
| `082 554 0033` | Solomon Mabunda   | Chairperson of Lehumo                                |
| `084 210 6690` | Kabelo Netshiozwi | Platform Administrator                               |

**Start with Nomsa.** She holds two different roles in two different clubs on
one account, which is the tenancy model the whole system is built around.

### Edge cases already in the seed

These are seeded deliberately so a demonstration can reach them without setup.

- Lerato Ndlovu is **in arrears at queue position 2** in Mmakau, so a payout
  refusal is one row below the head of the queue.
- Zanele Chauke **joined mid-cycle** and carries a catch-up obligation.
- Rhulani Baloyi has **exited** but his rows remain, because ledger history must
  keep resolving to a name.
- Martha Chabalala is **95 days into Lehumo's 180-day waiting period**, so a
  burial claim refusal is always available.
- Mmakau has an **unexplained R450 reconciliation difference**.

---

## Commands

Run from the repository root.

| Command                  | What it does                                       |
| ------------------------ | -------------------------------------------------- |
| `npm run dev`            | Both tiers                                         |
| `npm run dev:api`        | Express only                                       |
| `npm run dev:web`        | Next.js only                                       |
| `npm run migrate`        | Apply outstanding migrations                       |
| `npm run migrate:status` | Show which migrations have run                     |
| `npm run seed`           | Reload the demonstration data                      |
| `npm run db:rebuild`     | Drop everything, migrate, reseed (**destructive**) |
| `npm run build`          | Production build of the web application            |

---

## Where things live

```
server/src/
  middleware/        the cross-cutting modules, in the order they run
    authenticate.js    session cookie -> req.actor          REQ-4, REQ-5
    tenancy.js         club scope on every query            REQ-13, REQ-14
    authorize.js       role check before every operation    REQ-8
    audit.js           record()                             REQ-9
  rules/             pure functions: no Express, no SQL, no React
  modules/<feature>/ routes (HTTP) | service (rules) | repo (SQL)
  db/
    pool.js            connection pool AND the tenancy guard
    migrations/        numbered, run in order, never edited once applied

web/
  app/               routes
  components/ui/     primitives
  lib/
    api.js             the only place that calls the API
    session.js         cached view of the server session
    format.js          money and date presentation
```

Each feature module is three files. `routes` speaks HTTP and knows no rules.
`service` holds the rules and knows no SQL. `repo` holds the SQL and knows no
rules. That split is what makes the services testable without starting a server.

---

## Two things worth knowing before you read the code

**The tenancy filter is enforced, not advisory.** `pool.forClub(clubId)` inspects
every statement and throws if it touches a club-scoped table without a `club_id`
predicate. A developer who forgets the filter gets a loud error the first time
the query runs, rather than a silent leak. This is the implementation of "the
tenancy filter wraps all data access" from SDD 4.1.

**The active club lives on the session row in the database**, not in a header or
a request body. The client cannot assert which club it is operating in — it can
only ask the server to switch, and the switch checks membership inside the same
SQL statement that performs it. A request for a record in another club returns
404, never 403, because a 403 would confirm the record exists (REQ-14).

---

## Implementation status

The Milestone 4 preliminary release. All 17 functions in the milestone slice are
built, plus six beyond it.

**Built**

- Database schema, nine migrations, append-only ledger and audit log
- Authentication, sessions, lockout, full audit trail
- Tenancy filter and role-based access control
- Member register, registration with catch-up preview, role assignment
- Contribution cycles, capture, status resolution, the overpayment waterfall
- Automatic late penalties
- Club ledger and member statements
- Platform administration: provisioning, suspension, aggregate figures
- Home page, sign-in, club selector, dashboard
- Governance: meetings, quorum, resolutions, constitution amendments and resolution-based expulsion (Use Case 7)

**Scheduled**

- Payouts and the rotating queue (Use Case 3)
- Burial claims (Use Case 4)
- Reconciliation (Use Case 5)
- Assistant (Use Case 6)
- Notifications, defaulter pipeline, ledger export
- REQ-3 federated sign-in. Deliberately not shown on the sign-in page until it
  works — a button that does nothing is worse than no button.

See `docs/traceability.md` for the requirement-by-requirement record.

---

## Tests

```bash
npm test       # 243 tests, no database required
npm run check  # verifies every relative import resolves
```

The tests cover the rules engine, the permission matrix, monetary arithmetic and
password storage. They need no database and no network — the rules are pure
functions, so they are testable in isolation, which is what SRS 5.4 asks for
under Testability.

`npm run check` walks every `require()` in `server/src` and reports any that do
not resolve. A wrong relative path otherwise only surfaces when Node reaches
that line, which can be long after startup.

## Governance (Use Case 7)

This implementation uses migrations **016_governance.sql** and
**017_governance_completion.sql**. Keep 016 unchanged if it has already run; the
follow-on update is 017. Install dependencies and apply outstanding migrations
with the normal `npm install` / `npm run migrate`. Do not reseed or rebuild.

On **Governance**, the Chairperson first records the club's already adopted voting
rules with their source clause and effective date. No 100% or simple-majority
threshold is assumed. Record the General/Expulsion rules, amendment classes,
fractions, denominators and voting rights exactly as the constitution specifies.
This one-time capture is not authority to change a constitution. Subsequent voting
rule changes require a member resolution under the existing rules.

The Chairperson submits a pending amendment proposal. A Secretary or Chairperson
records the completed meeting and votes on that exact proposal. Advisory votes
cannot take effect. A carried resolution is applied once by the Chairperson.
Expulsion resolutions can name an eligible replacement officer, transferred in
the same transaction so the club retains its required officers.

The governance page also provides the read-only annual financial/membership report
for officers. It labels year-to-date periods, unverified membership dates, missing
or stale reconciliation and non-zero differences. It does not capture reconciliation
or advance default stages; those tasks remain separately assigned.

New contribution cycles pin the constitution selected by commencement (REQ-33).
Pre-existing cycles preserve the earlier lookup without rewriting money. Membership
history starts at migration 017: earlier eligibility cannot be guessed. Legacy
meetings remain readable, but old unconfirmed votes cannot be newly applied.
See decisions 37–39 in `Docs/Desicions.md` for these upgrade boundaries.

`npm run test:governance` runs an isolated PostgreSQL upgrade/service/HTTP test,
including legacy data preservation, proposals, threshold enforcement, atomic
succession, pinned cycle versions and annual reports. It needs no Supabase
credentials and does not reset shared data. `npm test` runs 254 unit tests.

### Date fixes and ledger reversals (migration 018)

After applying the previous governance and screen updates, apply outstanding
migrations with `npm run migrate` (keep migrations 016/017 unchanged). Ledger now
supports Treasurer corrections and payout reversal requests: Chairperson approves,
then Treasurer posts. The original remains immutable. Penalty waivers continue
through Contributions under REQ-63; see decision 42 for the REQ-92 exception.
Ledger reversal does not rewind source allocations, queue turns or claim workflows.

Dates remain YYYY-MM-DD for calendar values and timestamps display in South African
time. The database connection requests the same timezone. Run:

```bash
npm test
node server/integration/ledger-reversals.js
node server/integration/screens.js
npm run test:governance
npm run check
npm run build
```

Integration tests use an isolated engine, not the configured shared database.

### Installing updates on Windows

Stop the running Next.js development server with Ctrl+C before installing dependencies.
The `EPERM` warning for `next-swc.win32-x64-msvc.node` means Windows could not
remove a loaded native file; it does not mean the application tests failed.
Close the terminals running this project's development server, then run `npm ci`
from the repository root. This installs the versions in the committed lockfile.
If the file is still locked, restart Windows and run `npm ci` before starting the
application. For a recurring lock in a OneDrive-synced checkout, keep the working
checkout outside OneDrive. Do not delete your database or run `migrate:reset` to
resolve an npm file-lock warning.

`test:exit-writeoffs` deliberately injects an error after debt allocation to prove
that the transaction rolls back. An INFO line now labels that expected server
error. The command must finish with “Exit write-off integration passed” and exit
code 0. Unexpected errors still use normal server logging.

### Shared interface and dependency updates

The shared shell uses grouped, permission-filtered navigation: Overview, Money,
Club and My membership. At widths below 1024px, the Menu button reveals those
same groups; Escape closes it and returns focus to the button. The active club
and role stay visible. Burgundy action colours and warm neutral surfaces follow
the SDD section 6.4 references. The sign-in form keeps the existing phone/password
authentication. Google sign-in from the prototype is not implemented here.
System fonts avoid a font download during builds and on members' connections.

The dependency update moves Next.js from 14 to 15.5.27, retaining React 18.3.1
within that release's declared peer range. Express remains on version 4.
PostCSS is pinned to 8.5.28, including Next's nested copy, to cover the audited
source-map vulnerabilities. Commit package manifests and package-lock.json
together when integrating this change. Run `npm ci`, `npm audit`, `npm test`,
`npm run check`, the integration scripts and `npm run build` after merging.

### Integrated completion update (1 October 2026)

Conditional exits, source-compensating reversals and available teammate branches are
integrated. Read [the integration handoff](docs/integration-handoff.md) before upgrading:
it covers migrations 021–024, existing migration conflicts, verified behavior and
remaining accounting/teammate boundaries. Apply with `npm ci` and `npm run migrate`;
do not reset or reseed your existing database. Run `npm run test:integration` for the
six isolated database suites and `npm run test:browser` for real browser flows after
the Playwright setup described in the handoff
