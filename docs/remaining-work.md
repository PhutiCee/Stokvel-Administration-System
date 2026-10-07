# Current remaining work — 1 October 2026

This is the current inventory following review of racha dde4e0a and migration 025.
The historical inventory is available in Git history. Decisions 43–47 record
accounting and workflow boundaries. This is not a declaration of full SRS completion.

## Fixed in this delivery

- Treasurer-only cycle closure, confirmation, attribution, grace checks and atomic
  overdue penalty assessment; next cycle can be opened through the application.
- Unpaid members are assessed on closure; late capture assesses before allocating
  excess. Penalties remain once per member/cycle. A timer-driven sweep is not added.
- Penalty assessments and waivers no longer inflate/deplete available cash.
  Cash balances agree across operational pool, dashboard, assistant, statement,
  annual reports, platform aggregate and new reconciliations. Original entries and
  historical reconciliation snapshots remain unchanged.
- Assistant outstanding debt includes penalties/catch-up and distinguishes pool
  balance questions from personal balance questions.
- Interest/expense reversals feed year-end distribution calculations.
- The integration runner includes the legacy migration test and review-fix suite.

## Still assigned to other members

| Area | Remaining work |
|---|---|
| Standing / defaulters, REQ-44,101–103 | Caller/scheduler, constitution threshold persistence/editor, notifications, end-to-end acceptance |
| Notifications | Event dispatch, channel preferences, delivery records, retries, provider/mock and undeliverable list |
| Reconciliation UC5 | Full exception-resolution workflow and complete REQ-97 comparison; this patch only aligns its balance query with cash |
| Authentication | Federated sign-in REQ-3 and password re-entry REQ-11 |
| Contributions | Batch capture REQ-58 |
| Export | Full REQ-100 export; statement browser printing already exists |
| Assistant | Complete REQ-119–128 compliance; local answer fixes do not complete external intent classification/audit requirements |

## Business/workflow boundaries

- Define the adopted meaning of a full rotation for conditional exits. Supported
  mappings are membership days or closed fully paid cycles; unsupported predicates
  require an extension or constitution amendment.
- Reconcile REQ-112's penalty expenditure wording and the REQ-80/81 distribution
  formula with retained/collected penalties. The system does not force an unequal
  distribution through by changing the pool or inventing an allocation rule.
- Legacy receipts/payouts without evidence, conflicting downstream activity,
  ended memberships, exit settlements and whole-distribution reversals need their
  own complete correction workflows; isolated reversals remain refused.
- A background contribution-penalty sweep is still needed for unattended assessment
  at grace expiry. Current triggers are capture and cycle closing, not GET requests.
- Complete browser/device acceptance beyond the supplied Chromium flows, and the
  SRS user manuals/help deliverables.

## Apply and verify

Add migration 025 and replace all files listed in the delivery manifest. Run
`npm run migrate` (never reset/reseed existing data), then `npm test`,
`npm run test:integration`, `npm run check`, and `npm run build`.
Browser setup remains in `docs/integration-handoff.md`.
Next migration number after this delivery: 026.
