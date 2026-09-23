# Stokvel Administration System

Administration for rotating savings clubs, grocery stokvels and burial societies.

Group 5 · SCSC082 Software Engineering · Department of Computer Science,
University of Limpopo · 2026

Built to the approved Software Requirements Specification v1.0 and the Detailed
System Design Document.

---

## Architecture

Three tiers, as described in SDD section 4.

| Tier | Technology | Directory |
|---|---|---|
| Presentation | Next.js 14 (App Router), Tailwind CSS | `web/` |
| Application | Node.js, Express, REST API | `server/` |
| Data | PostgreSQL 15 (hosted on Supabase) | `server/src/db/` |

The two tiers run as separate processes and talk over HTTP. The web application
holds no database credentials and performs no data access of its own.

**Supabase is used as a PostgreSQL database and nothing else.** The Supabase
JavaScript SDK, PostgREST, Supabase Auth and Row Level Security are all
deliberately unused: authentication, authorisation and tenant isolation belong
in the application tier, which is where the design document places them. See
`docs/decisions.md`.

---

## Getting it running

You need Node.js 18.17 or later and a Supabase project.

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

| Phone | Person | Holds |
|---|---|---|
| `082 441 7788` | Nomsa Maluleke | Treasurer of Mmakau, **ordinary Member of Bokamoso** |
| `073 902 1145` | Thabo Mokoena | Chairperson of Mmakau, Member of Lehumo |
| `071 334 9026` | Refilwe Mahlangu | Secretary of Mmakau |
| `082 201 5566` | Grace Baloyi | Chairperson of Bokamoso |
| `082 554 0033` | Solomon Mabunda | Chairperson of Lehumo |
| `084 210 6690` | Kabelo Netshiozwi | Platform Administrator |

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

| Command | What it does |
|---|---|
| `npm run dev` | Both tiers |
| `npm run dev:api` | Express only |
| `npm run dev:web` | Next.js only |
| `npm run migrate` | Apply outstanding migrations |
| `npm run migrate:status` | Show which migrations have run |
| `npm run seed` | Reload the demonstration data |
| `npm run db:rebuild` | Drop everything, migrate, reseed (**destructive**) |
| `npm run build` | Production build of the web application |

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

**Scheduled**

- Payouts and the rotating queue (Use Case 3)
- Burial claims (Use Case 4)
- Reconciliation (Use Case 5)
- Assistant (Use Case 6)
- Governance: meetings, quorum, resolutions (Use Case 7)
- Notifications, defaulter pipeline, ledger export
- REQ-3 federated sign-in. Deliberately not shown on the sign-in page until it
  works — a button that does nothing is worse than no button.

See `docs/traceability.md` for the requirement-by-requirement record.

---

## Tests

```bash
npm test       # 196 tests, no database required
npm run check  # verifies every relative import resolves
```

The tests cover the rules engine, the permission matrix, monetary arithmetic and
password storage. They need no database and no network — the rules are pure
functions, so they are testable in isolation, which is what SRS 5.4 asks for
under Testability.

`npm run check` walks every `require()` in `server/src` and reports any that do
not resolve. A wrong relative path otherwise only surfaces when Node reaches
that line, which can be long after startup.