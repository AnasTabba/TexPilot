# Authoritative planning follow-up for both OpenCode 2 workers

Read `implementation-plan.md` and `coordination-state.json` first. User clarified the scope on 28 October: **planning only**. Do not implement application code, change schema, deploy, call paid APIs, send messages to businesses, or request secrets. Current configured OpenCode 2 model is quota-limited until its reported 29 October 05:14 AM reset (Asia/Karachi); do not repeatedly relaunch before that condition changes.

Original attempts are failed/released. After reset, original coordinator retries the same two Tasks using their matching `--retry-of` IDs, starts both before waiting, and sends this follow-up to each new authoritative Dispatch. Do not send to the already-settled Dispatches.

## Worker A: supplier portal, procurement and DataLoopLabs

- Task `task_5c7e794af0a8`, failed attempt `ctx_5c4095e17fc4`.
- Own only `procurement-and-tracking.md` in this directory.
- Produce a technical implementation plan covering supplier register/login, email verification, pending approval, admin approve/reject/suspend, organization claim and category approval, scoped RFQ inbox/bids, atomic award/PO and supplier dispatch notices with B/L.
- Selected provider is **DataLoopLabs**, replacing the original Task's provider comparison as the primary design. User has a key; planning must not retrieve or use it. Detail server-secret storage, actual B/L contract discovery, carrier/container mapping and multi-container billing.
- Apply screenshot terms with evidence labels: no free credits, USD 1.20–2.00/credit by tier, first-track and 30-day renewal costs, ordinary same-user repeat tracking within window free, force-update always charged, 100 requests/minute/key default. No invented endpoints or assumption that one B/L equals one credit.
- Include cost authorization, budgets/reservations, provider-account deduplication, ordinary vs paid force refresh, no automatic renewal outside policy, rate limiting, ambiguous-charge failures, stale state, credit reconciliation and exact live acceptance gates for eventual implementation.
- Research official documentation and cite what is actually accessible. Identify unknowns; examples on a marketing page do not prove actual tracking works.
- Output states, data model/API contracts, permission checks, domain tickets and measurable acceptance tests. Read coordinator mailbox before finishing and send `worker_done` under the new live preamble.

## Worker B: production, sales, inventory and access

- Task `task_f37e1243900b`, failed attempt `ctx_a9e1913d3387`.
- Own only `production-sales-and-permissions.md` in this directory.
- Independently review existing schema/API and plan raw receipt/QC/QR, usable versus quarantined stock, reservations, buyer PO/quote approval, uniquely linked production batches, machine capacity/shifts, actual output/waste, packing, finished QC and dispatch/delivery.
- Detail invoice generation once per approved order revision, buyer document delivery, payment terms snapshots, delivery-plus-30-calendar-day due schedules, partial delivery/payment and deduplicated sales-manager reminders.
- Define internal role presets and server permissions, explicitly keeping approved supplier accounts separate from internal staff and buyers. Pending/rejected/suspended supplier accounts have no RFQ/bid/dispatch privileges.
- Resolve metres vs kilograms without rewriting historical quantities, preserve immutable stock history, and cover concurrency, idempotency, organization/workspace isolation, audit, bilingual/mobile flows and migration/release gates.
- Output concrete tables/routes, lifecycle transitions, parallel build tickets/dependencies and acceptance tests. Planning only. Read coordinator mailbox before finishing and send `worker_done` under the new live preamble.

## Coordinator closure

Review both actual reports, resolve differences in the master plan, account for every requirement and cite sources. Accept actual settlements, release workers, record blockers and remove `ACTIVE` when planning/review settles. Never change this scope into application implementation because a schedule fires. If the quota persists, record the new evidence and defer to its next documented reset without duplicate editors or tight retry loops.
