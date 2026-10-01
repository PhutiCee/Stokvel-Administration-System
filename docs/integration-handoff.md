# Integration handoff — 1 October 2026

Base: `racha` at `661011d09177c5f1d09e0bf087f010b8a49d9447`.
Working branch: `fix/racha-navigation-and-dependencies`.

## Changes included

- SDD burgundy and warm light palette, grouped desktop navigation, mobile menu,
  clearer login and explicit confirmations for contribution and payment actions.
- Audited dependencies: Next 15.5.27, Express 4.22.3, cookie-parser 1.4.7,
  PostCSS 8.5.28. Node 18.18 or later is required.
- Conditional exit mapping: membership days or completed fully paid cycles,
  explicit threshold and meaning, before/after rates, notice or settlement evaluation.
- Atomic reversal of tracked contribution allocations and credits, linked closed-cycle
  correction, rotation queue restoration and claim reopening. Original receipts and
  approvals are retained. Payout ledger links are now actually stored.
- Available teammate branch integration, preserving existing governance routes/migrations.

| Branch | Merged head | Integration work |
|---|---|---|
| lindo | `0eba26e377f23930e1f72db0704d3899a4991cb4` | Notifications and reconciliation routes, pages, navigation and permissions; selected-date reconciliation with transaction lock and gap explanation |
| racha-default | `50f8a2c7848dd2465a773398d82bdddd3c194e92` | Standing engine, rules and tests; write-off-aware debts, cycle-pinned grace periods and club lock |

The incoming assistant conflict was resolved in favor of the existing racha assistant.
Gemini forwarding of personal/financial context is not connected. The owner must
reconcile it with the SRS before integration. No external messages were sent.

## Apply without deleting your data

Use a clean checkout of the base when applying the full patch. If you already applied
`7e7bf83` (the earlier dependency/navigation fixes), use the incremental completion patch
instead. Run `git apply --check <patch>` before `git apply <patch>`. A full source zip
is also provided. Keep your existing environment configuration and uploaded proofs.

```sh
npm ci
npm run migrate:status
npm run migrate
npm test
npm run test:integration
npm run check
npm run build
```

Do not run reset, reseed or db:rebuild on an existing database. Back up the database
before applying migrations in your shared environment. Migrations 021–024 add source
compensation, notifications, standing history and evidence guards. Teammates' two
conflicting 016 migrations were renamed 022 and 023; governance 016 is unchanged.
The migration runner verifies existing notification/standing structures against the
canonical schemas before adopting renamed 022/023. Matching columns, defaults,
constraints, indexes and immutability triggers are required. Matching existing tables
are retained and the new filenames recorded alongside old history. A mismatch stops
without marking that migration applied. Do not clear the migration table or drop data. No shared database was migrated here.
Next available migration number: **025**.

## Verification

- 273 unit tests pass; import check and production build pass.
- Seven isolated database/service/HTTP suites cover completion, exit write-offs,
  governance upgrade, supporting screens, reversal permissions and source compensation.
  Each creates an in-memory PostgreSQL-compatible PGlite database; the runner never
  resets your configured database. An injected exit failure deliberately tests rollback.
- `npm audit` reports zero vulnerabilities at verification time.
- Real Chromium checks use the production web build and real API with an isolated
  database: capture confirmation and Escape, receipt reversal/recapture, payout
  initiation/approval, reversal request/approval/post, queue restoration, mobile
  navigation and member permissions. Merged API checks cover invalid dates,
  explanation-required gaps and cross-club isolation.
- Conditional exit unit tests cover exact boundaries, monetary rounding and rejected
  unsupported conditions; completion checks verify immutable notice facts.

To rerun browser checks, install Playwright in a separate test-tools directory and its
Chromium browser. Set `PLAYWRIGHT_MODULE` to that installation's absolute playwright
module directory, then run `npm run build` and `npm run test:browser`. Alternatively,
use an already installed `playwright` module. `PLAYWRIGHT_EXECUTABLE_PATH` optionally
selects an installed Chromium executable. Ports 4000 and 3100 must be free; the test
starts and stops both servers itself. Local verification used Playwright from the
runtime with Chromium headless shell 1161. This is not full Safari/Firefox or
physical-device acceptance, nor browser coverage of every governance/exit/claim flow.

## Remaining boundaries and owner decisions

1. **Accounting agreement is still required.** Positive penalty assessments plus
   collection in a Contribution receipt conflict with a cash interpretation of the
   pool and REQ-112. No historical balances are silently reclassified. Retained exit
   forfeiture remains a zero-cash Adjustment backed by the settlement assessment.
2. **Reversal is deliberately limited.** Legacy entries without source evidence,
   written-off obligations, ended memberships, conflicting later queue/payout changes,
   exit settlements and whole distributions are refused. Compound reversals need a
   complete workflow, not a reversal of just one payout row.
3. **Adopted exit meaning must be supplied.** “One rotation” is not automatically a
   number of cycles. Unsupported conditions require another explicit mapping.
4. **Teammates retain their assignments.** Standing scheduling/configuration,
   notification event dispatch/preferences/retries/providers, full reconciliation
   exception resolution, batch capture, exports and authentication extensions are not
   made complete by merging their current branches. Merge any later commits separately.
5. **GitHub delivery is pending access.** Changes are committed locally and packaged;
   they were not pushed to the remote branch. GitHub authentication was unavailable.

Decisions 45–46 in `Docs/Desicions.md` and the current updates in
`docs/remaining-work.md` / `docs/traceability.md` supersede older gap descriptions.


### Fix for “relation notification already exists”

An earlier package did not adopt teammates' already-applied migrations after renaming
016 to 022/023. Replace `server/src/db/migrate.js` and add the two accompanying
`legacy-migrations.js` / `legacy-migration-shapes.json` files, then run
`npm run migrate` again. Already-applied 021 is skipped. Verified existing 022/023
schemas are recorded without recreating their tables. Migration 024 then runs normally.
The regression test `node server/integration/legacy-migrations.js` exercises the real
runner with retained notification data, old filenames, mismatch refusal and repeat runs.
