# Remaining implementation: OpenCode 2 ownership and estimate

Updated 28 October 2026. The first procurement/receiving release is pushed and live. User direction: OpenCode 2 performs remaining implementation; Codex plans, coordinates and reviews evidence.

## Estimate

Initial estimate: **4–7 working days after two workers have usable quota**, assuming responsive review and available integration inputs. Production and sales run concurrently for approximately 2–3 days, tracking setup takes 1–2 days, and integration/regression/release checks take 1–2 days. This is a planning estimate without measured OpenCode 2 throughput, not a promised delivery date.

The earlier free model exhausted its quota. On 28 October the user changed the configured model; both initial implementation workers now visibly use GLM-5.3-Flash Free and have begun repository work. The old reset gate is removed. Quota failures remain explicit external blockers; do not buy upgrades or select another model without user direction.

## Wave 1: parallel implementation workers

Both workers start in separate worktrees from the latest pushed `feat/erp-workflows`. They must not edit the original dirty worktree, models/training, PRODUCT.md or production data. Shared app/router/lockfile edits belong to the later integration owner.

### A: production and manufacturing stock

Own new `server/production.mjs`, `src/Production.tsx`, `src/production-client.ts`, `drizzle/0005_production.sql`, production-specific tests/styles and a report.

Implement admin-configured machines/versioned capacities, shifts/calendars, allocations, actual runs/downtime, buyer-order-linked batches, reservations/issue, output/waste reconciliation, rolls, packing, QC and lifecycle guards. Completion requires actual output and QC. Preserve grams, metres and counts as separate measured quantities.

Yarn-to-cloth conversion needs a reviewed transformation that consumes input lots and creates output lots. Never disguise consumed material as waste/customer dispatch, leave duplicated WIP stock or invent a universal kg-to-metre conversion. Extending the constrained ledger action vocabulary may require a carefully rehearsed table rebuild preserving all rows, foreign keys and triggers. This is a release gate.

Acceptance: machine capabilities/capacity, overlapping shifts, quarantined/unavailable stock, concurrent reservations/consumption, measured quantities/mass reconciliation, partial output, holds/rework, permissions, workspace isolation and buyer-to-input-lot traceability are tested.

### B: buyer orders, invoices and receivables

Own new `server/sales.mjs`, `server/buyer-portal.mjs`, `src/Sales.tsx`, `src/BuyerPortal.tsx`, `src/sales-client.ts`, `drizzle/0004_sales.sql`, sales-specific tests/styles and a report. Report exact PDF dependency/lockfile requirements to the integration owner.

Implement buyer records/scoped portal identities, buyer PO/specs/quantity/payment terms, quote revisions and approval, confirmed orders, one immutable numbered invoice per approved revision, downloadable documents, queued delivery, partial dispatch/delivery/payment and delivery-triggered receivables. A configured 30-day term begins at confirmed delivery in Asia/Karachi. Reminders are deduplicated, stop after settlement and target the assigned active sales manager with admin fallback.

Do not claim queued email was sent, assume tax rates/compliance or change approved terms silently. Test stale/duplicate approvals, invoice numbering races, exact money/units/currency, partial fulfilment/payment, month/year boundaries, corrected delivery dates, duplicate jobs and buyer/financial authorization.

## Shared contract

- `0004_sales.sql` defines `sales_orders(id, workspace_id, reference, buyer_id, status, created_at)` and `sales_order_lines(id, workspace_id, sales_order_id, product_id, specifications, quantity_milli, unit, created_at)`. `product_id` may be nullable until mapping; additional columns are allowed.
- `0005_production.sql` references `sales_order_lines.id`. A production batch belongs to one confirmed sales order line for the first release. Do not create duplicate buyer-order systems.
- Quantities are fixed point in a declared unit (`kg`, `metre`, `piece`); mass remains integer grams. Existing procurement tonne receiving remains supported. Money is integer minor units plus currency.
- Export `productionApi(request,env,member,path,data)` and `salesApi(request,env,member,path,data)` for `/api/erp/production/*` and `/api/erp/sales/*`. Buyer portal uses `/api/buyer/*` with a separate identity/cookie. Reuse `erp-utils.mjs`.
- Existing internal permissions include `production`, `produce`, `receive`, `dispatch`, `qc`, `sales`, `payments`; machine setup is admin-only. External users never gain staff rights.
- Screens receive `member` and `onInventoryChanged` when changing stock. One integration worker wires shared navigation/hash routing/auth/types.
- Until the sales migration exists in A's branch, a minimal sales-order contract is allowed only in its test fixture, never a placeholder production migration.
- Ask the coordinator before changing the shared contract. Keep commits scoped and provide test output plus a handoff report.

## Wave 2

DataLoopLabs now runs concurrently as worker C: own new tracking/budget modules, `0006_tracking.sql`, tracking UI/tests and its report. Implement account-scoped deduplication, budget/credit reservations, explicit paid force refresh, 30-day renewal policy, rate limiting and stale/error states. Obtain the actual API contract; do not guess endpoints/auth from marketing examples. No paid calls until the configured policy authorizes an allowance. If documentation remains missing, report the exact blocker and keep live tracking unconnected.

After A and B settle and the UI handoff is reviewed, assign one OpenCode 2 integration owner to merge their reviewed commits, own shared router/navigation/auth/type/lockfile edits and run combined migration/mobile/security tests. Tracking can proceed alongside internal integration in its separate worktree. Do not publish unfinished domain branches.

## Supervision

Automation `c3ddf186-21f7-4901-9d13-0371380000f4` checks every 30 minutes. Its local gate skips model launches when ACTIVE is absent or a new documented quota reset is pending. It nudges the original coordinator if idle. User authorized six concurrent OpenCode 2 workers: production, sales, tracking, independent finish review, advisory quality supervisor, and visual/interaction polish. Do not duplicate their active dispatches. Integration waits for domain and UI handoffs. Never substitute another model, duplicate active editors or run production fixtures.

Record quota failures explicitly and retry only after a documented reset or available user configuration. Preserve the live scanner and first ERP release. Remove ACTIVE when authorized work settles or a missing coordinator prevents supervision; document external blockers. Codex coordinates rather than writing more application features.

## Product finish and milestone review

The user requires a usable, easy-to-learn operational app. Every visible action must complete the real authorized job with clear validation and saved results. No invented metrics, pretend tracking, no-op controls or claims that queued delivery was sent. Walk through procurement, bid award, receiving/QC/QR, stock, buyer batch production, dispatch, invoice and settlement.

Dedicated UI worker owns existing CSS and presentation portions of SignIn, WorkspaceDashboard and LiveApp in its isolated worktree; domain workers continue owning their new screens. Use warm textile colours, refined hierarchy and selective elegant italic headings with readable upright body/data and proper Urdu fonts. Add purposeful interaction feedback and short state transitions with reduced-motion support. Require desktop/mobile screenshots and keyboard/contrast/Urdu checks.

Independent finish review identifies actual integrity/security gaps and acceptance scenarios. Advisory supervisor guides all workers at architecture, first tests/screenshots and handoff, without changing lifecycle or shared contracts. Root reviews evidence and resolves contracts. Integration/release requires combined functional, migration and visual review.

Recommended finish: role-specific Needs attention queues and one linked order timeline across procurement, QC, production, shipping and payments. These are proposed product improvements; do not represent them as already implemented.
