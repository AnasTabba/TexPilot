# Yarnflow ERP — implementation-quality supervision report

Supervisor dispatch `ctx_0a76f7d8b0e7` (terminal `term_ad198ebe-74ec-4180-b43e-b89154058fa6`), run `run_5e3706b32318`. Advisory only: no app edits outside this report, no lifecycle changes for other workers, contract-change proposals forwarded to root rather than granted. Initial report of an ongoing milestone-supervision pass; superseded sections will be appended as milestones arrive.

## Current supervision set (six authorized workers)

| Worker | Dispatch | Worktree | Stage at first review |
|---|---|---|---|
| Production (Wave 1 A) | `ctx_c53aac1d4dd1` | `erp-production` | baseline `0475098`, no commits yet |
| Sales (Wave 1 B) | `ctx_9fc971c271e8` | `erp-sales` | baseline `0475098`, no commits yet |
| Tracking (Wave 2) | `ctx_37eb8c8ebbbe` | `erp-tracking` | baseline `0475098`, no commits yet |
| Finish review | `ctx_6823f0d9cafe` | `erp-finish-review` | baseline `0475098`, no commits yet |
| UI finish | `ctx_bae8a856c6c3` | `erp-ui-finish` | added by root after initial brief |
| Operational chat | `ctx_297c6b873185` | `erp-collaboration` | added by root; owns `0007_collaboration.sql` |
| Follow-up reviewer | `ctx_57881c4e50f7` | (per root) | correcting finish-review evidence + completeness matrix |
| Supervisor (this report) | `ctx_0a76f7d8b0e7` | `erp-supervision` | active across milestones |

All four original worktrees were verified clean at baseline commit `0475098` ("Record ERP release and queue parallel implementation with scanner supervision") on first inspection — evidence is `git status --short` empty + `git log` matching baseline in each worktree. Workers therefore had no code to review yet; initial guidance was plan-based against the real baseline below. Chat worker guidance sent as `msg_dfbcdbbd9f0e` (event adapters by message only, no fake realtime, no approval-via-chat, deduplicated permission-scoped alerts, portal isolation, no cross-module hard FKs into other workers' uncommitted migrations). At a later checkpoint the four implementation worktrees showed active uncommitted work (production `0005_production.sql`; sales `0004_sales.sql` + `server/sales.mjs`; tracking `0006_tracking.sql` + `server/datalooplabs.mjs` + `server/tracking-budget.mjs`; UI screenshot tooling) — the model is working; the earlier quota-stall narrative is stale and no longer assumed.

## Baseline contract facts verified in code (not from the plan alone)

- `drizzle/0000_inventory.sql`: `movements.action` CHECK is `('receive','dispatch','transfer','waste','reverse')`; `balances.stage` CHECK is `('raw','wip','finished','cops')`; movements/stock_deltas/quality_events/erp_audit_events are immutability-trigger-guarded. SQLite cannot ALTER a CHECK — any new action vocabulary needs a rehearsed table rebuild preserving rows/FKs/triggers, or a domain event table paired with existing actions. Treated as a release gate and a shared-contract change requiring root approval.
- `drizzle/0003_purchase_receipts.sql`: `quantity_milli` fixed-point convention, `price_minor` + currency CHECK `('PKR','USD','EUR','GBP')`, `purchase_terms_immutable` trigger (pattern to reuse for approved sales terms), over-receipt protection computed excluding reversed receipts.
- `server/erp-utils.mjs`: shared validators (`text`, `multiline`, `integer`, `recordId`, `email`, `phone`, `keys`, `readJson`, `allow`, `audit`, `date`) and `ErpProblem` status-carrying errors. All new handlers must reuse these instead of inventing validation.
- `server/worker.mjs`: routes all `/api/*` to `inventoryApi` today; new domain routers (`productionApi`, `salesApi`) are wired by the integration owner, so domain workers must not edit `worker.mjs`.
- `src/i18n.tsx`: `useLanguage()` + `t('English', 'اردو')` inline pairing is supported; global RTL via `dir`. Workers should pass Urdu inline instead of editing shared `ui-copy.ts`/`translations.ts`.
- `tests/inventory-api.test.mjs`: node:test + in-memory `node:sqlite`, replays `drizzle/*.sql` sorted, seeds via `seedRows(PIN)`, calls the API handler directly. This is the required test convention for new domain tests.
- Existing internal permissions include `production`, `produce`, `receive`, `dispatch`, `qc`, `sales`, `payments`; machine setup is admin-only. External users never gain staff rights.

## Initial guidance sent (durable, per worker)

Messages were sent with `--to dispatch:<id>` so each worker's coordinator relays them durably; each asks the worker to send three milestones (architecture note, first passing tests/screenshots, final handoff with files + evidence) to dispatch `ctx_0a76f7d8b0e7`.

- Production — `msg_7de03e22b8f9`: ledger mapping disclosure, no-disguised-waste/no-duplicate-WIP/no-invented-conversion gates, concurrency + hold + permissions + audit + workspace-isolation checks, shared-file ban.
- Sales — `msg_06f9c40d0058`: exact contract tables, invoice-number race safety, approved-terms immutability, Asia/Karachi 30-day term math, reminder dedup/stop/fallback, queued ≠ sent honesty, buyer-portal isolation, exact money/integer assertions.
- Tracking — `msg_9ab3756833ce`: real contract only (no guessed endpoints), no invented tracking events, no paid calls without authorized allowance, reservation release on failure, account-scoped dedup, renewal/rate-limit testing with clock injection, honest stale/error states.
- Finish review — `msg_4b20ecef0915`: scope confirmation first, then evidence-quality gates (exact file/line + reproducible check, written/tested/integrated/deployed classification, whole-job scenarios, blockers vs cosmetics).
- UI finish — `msg_18324f2dc54c`: presentation-only ownership, business logic preserved, token coordination by message, purposeful motion with real reduced-motion support, mobile/Urdu/keyboard gates, honest states preserved, real-state screenshots, existing e2e suite before handoff.

## Per-worker gate checklists (release-relevant, at handoff each worker must show)

### Production (`erp-production`, `ctx_c53aac1d4dd1`)

1. Architecture milestone: `0005_production.sql` schema + `productionApi` surface + explicit ledger mapping for yarn-to-cloth (which existing actions or rebuilt vocabulary, and how input/output lots relate).
2. Mass reconciliation: consumed input = output + recorded waste; a single event must not leave one lot counted at two stages; output creates real `lots` rows.
3. Traceability: production batch references exactly one confirmed `sales_order_lines.id`; buyer → input-lot trace demonstrable end to end.
4. Quantities: grams / metre / count kept as separate measured quantities; no universal kg-to-metre conversion invented.
5. Concurrency: two concurrent reservations/consumptions on one lot cannot over-consume (test with real parallel calls).
6. Holds: `hold`/quarantined stock cannot be consumed or dispatched.
7. Permissions: machine setup admin-only; `produce`/`production`/`qc` etc. enforced per action via `allow()`; 403 for members without them.
8. Every handler validates with `erp-utils` and writes `erp_audit_events`; workspace isolation on every query (cross-workspace IDs rejected).
9. Lifecycle guards: partial output, holds/rework, QC-before-completion tested; no completion without actual output + QC.
10. No edits to shared files (`worker.mjs`, `src/App.tsx`, `ui-copy.ts`, `translations.ts`, lockfile); minimal sales contract only in test fixtures per plan.

### Sales (`erp-sales`, `ctx_9fc971c271e8`)

1. Architecture milestone: `0004_sales.sql` (contract tables verbatim) + `salesApi`/buyer-portal surface + reminder/delivery job model.
2. Invoice integrity: one immutable numbered invoice per approved revision; `UNIQUE(workspace_id, invoice_number)` + retry; concurrent-approval race test.
3. Terms immutability after approval (trigger pattern like `purchase_terms_immutable`); stale/duplicate approvals rejected 409/422.
4. Timezone: 30-day term from confirmed delivery in Asia/Karachi with explicit TZ math; month/year boundary + corrected-delivery-date tests.
5. Reminders: deduplicated, stop after settlement, target assigned active sales manager with admin fallback.
6. Status honesty: queued/failed/sent are distinct states with timestamps; queued never rendered as "sent"; no mail provider configured ⇒ "queued, not yet sent".
7. Partials: partial dispatch/delivery/payment; over-dispatch/over-payment rejected; receivables trigger on delivery.
8. Portal isolation: `/api/buyer/*` separate identity/cookie; buyer cookie against `/api/erp/*` must fail; external users never gain staff rights.
9. Exact money/units: integer minor units + currency in every assertion; no float math.
10. PDF dependency needs reported to integration owner (not silently added to lockfile).

### Tracking (`erp-tracking`, `ctx_37eb8c8ebbbe`)

1. Architecture milestone with the actual DataLoopLabs contract (source cited); if unobtainable, exact blocker report and live tracking left unconnected.
2. No invented tracking events; explicit "not connected + reason" UI state.
3. No paid calls without authorized allowance; paid force refresh requires explicit confirmation and records who paid for what.
4. Budget/credit reservations reserve-before-spend, release-on-failure; concurrency tests.
5. Account-scoped dedup (one consignment row per account+reference); duplicate refresh tests.
6. 30-day renewal + rate limiting tested with injected clock; stale/error states show last-success time.

### Finish review (`erp-finish-review`, `ctx_6823f0d9cafe`)

1. Scope confirmation sent to supervisor first.
2. Findings carry exact file/line + reproducible command/scenario.
3. Every finding classified written / tested / integrated / deployed; no "done" claims without evidence.
4. Whole-job acceptance scenarios outrank unit passes.
5. Blockers (no-op buttons, queued-as-sent, invented data, permission gaps, duplicate stock, missing states) flagged as release blockers.

### UI finish (`erp-ui-finish`, `ctx_bae8a856c6c3`)

1. Design-direction note: palette, italic headings, motion inventory with purpose per animation.
2. Presentation-only scope: business logic/handlers/permissions preserved verbatim; no API changes; no edits into other workers' branches.
3. Keyboard reachability + visible focus preserved; every control still performs its real action.
4. Purposeful motion only; `prefers-reduced-motion` verified to actually disable movement.
5. Mobile pass: touch targets, safe areas, no horizontal scroll.
6. Urdu pass: RTL mirroring, readable Urdu strings, language switch intact.
7. Honest states: loading/error/empty/success still visible; no demo data in screenshots.
8. Existing e2e suite green before handoff (`npm run test:e2e`) with results in the handoff.

## Risks to root (informational)

- Ledger action-vocabulary extension (production) is the highest-risk shared-contract item; if the architecture note proposes a table rebuild, it must include the rehearsed migration with row/FK/trigger preservation proof before root grants it.
- PDF generation for invoices will likely require a new dependency; must be reported to the integration owner and never added to the lockfile by the sales worker.
- Five domain/UI workers + integration later means shared-file conflicts are inevitable if anyone touches `worker.mjs`/`App.tsx`/`ui-copy.ts`; guidance bans it explicitly, and the integration owner wires the routers.
- Free-model quota resets reported by the plan (next slot 05:30 AM PKT) remain outside my control; note corrected 16:31 UTC — the current model is working and workers show active uncommitted progress, so the earlier quota-stall narrative is stale. If a worker stalls on quota, evidence will show inactivity rather than code movement.

## Update 1 — finish-review handoff received and verified (28 Oct)

Finish review (dispatch `ctx_6823f0d9cafe`) delivered its handoff: report at `erp-finish-review/yarn-erp/docs/plans/erp-expansion/finish-review.md`, commit `17ed12a` on `AnasTabba/erp-finish-review`, unit suite re-run 66/66 pass, no app code touched. I verified three load-bearing claims against baseline code myself rather than trusting the prose:

- **F1 supplier impersonation — mechanics verified; severity rejected by root.** `server/supplier-portal.mjs` register path inserts a `suppliers` row from free-text `data.company`; `drizzle/0002_procurement.sql` has no `UNIQUE(workspace_id,name)` on `suppliers` (only e-mail uniqueness on `supplier_users`). The collision path is real, but root's decision (16:31 UTC): the exploit scenario requires an admin to explicitly attest verification they did not perform, no bypass of pending/admin review was demonstrated, and duplicate company names do not bypass the single RFQ winning-award constraint. No `UNIQUE(company name)` mandate; duplicate detection / verified-claim matching is fraud-prevention UX and validated procurement-depth work, not an emergency P0 without exploit evidence. The minimum mitigation (approve-time collision display + `supplier.claim` audit linkage) remains recommended for the same reasons, but as UX-depth work with root as its owner, not a P0 gate.
- **F3 (P1) missing staff-lifecycle audit — verified.** Grep over `server/inventory.mjs` lines 360–410 (`usersRoute`) finds zero `audit(` calls.
- **F4 (P1) PO status dishonesty — verified.** `server/procurement.mjs` dispatch path sets `status='dispatched'` unconditionally; `server/receiving.mjs:46` reversal CASE flips to `dispatched`/`accepted` without recomputing the received residual.

The report met the evidence gates I set (exact file/line, reproducible scenarios, live/written/gap labels, explicit non-ownership section). Its dispatch is now settled, so no reply channel exists; its content is carried forward instead. Severity labels below are the review's own and have been superseded by root's decisions of 16:31 UTC (message `msg_652de0fd85e4`): F3 and F4 accepted as actionable integration-owner corrections (not production-owner work); migration rehearsal accepted as an integration gate; F1 severity rejected — no demonstrated bypass of pending/admin review and duplicate names do not bypass the single-award-per-RFQ constraint, so no `UNIQUE(company name)` mandate (legitimate same-name entities and branches exist); duplicate detection / verified-claim matching is classified as fraud-prevention UX and validated procurement-depth work, not an emergency P0 without exploit evidence. Buyer actor support belongs to the sales migration owner, tested together with chat actor needs. `0007_collaboration.sql` must not weaken global audit actor checks and must document its integration approach with sales. A follow-up reviewer (`ctx_57881c4e50f7`) is correcting evidence and the original-requirement completeness matrix; corrected severities supersede the review's original labels when they arrive. F12 financial invariants folded into the sales/production gate lists (message `msg_0cea49e7ecd5` to sales, `msg_b81a6ff3bd2e` to production), F9 rehearsal discipline + error-code guidance sent to tracking (`msg_45379e503425`), and a root progress note with my proposed contract decisions sent to run `run_5e3706b32318` (`msg_9cc76ac46a83`) — root's decisions above supersede my proposals where they differ. I do not grant contract changes.

Per-worker gate deltas accepted into the checklists above: production gains workspace-scoped `sales_order_line_id` validation, per-run spec conversion factors, and migration-rehearsal evidence; sales gains invoice counter/`db.batch()` atomicity, idempotent buyer approval, reminder-dedupe unique key, separate buyer identity namespace, and stable error codes (and owns the buyer `actor_type` migration — GRANTED by root, relayed as `msg_fc06b36bffc6`); tracking gains rehearsal discipline and error codes. Chat worker ownership confirmed as `server/collaboration.mjs`, `src/Collaboration.tsx`, `src/collaboration-client.ts`, `0007_collaboration.sql` and its report, with the constraint that `0007` must not weaken the global audit actor CHECK and must document its actor integration approach with sales (relayed as `msg_af3a4bd3c7a1`). The F1 bounded minimum fix (additive dedupe/claim migration, approve-time collision display, `supplier.claim` audit event) is to be assigned by root to a settled worker terminal after the follow-up reviewer's revalidation; the reviewer does not implement fixes.

## Evidence standard going forward

Every claim in future report updates will be labelled: **written** (code exists), **tested** (test output shown), **integrated** (merged/combined run), or **deployed** (live). Initial guidance above is **delivered** (durable orchestration messages listed by ID); no functionality beyond the baseline release is yet claimed for any worker.

## Update 2 — chat architecture milestone reviewed (28 Oct)

Chat worker (`ctx_297c6b873185`) delivered milestone 1/3. Verdict: **accepted with 4 items** (`msg_0140ddf6d83f`). Verified against its constraints: additive schema referencing only tables present in its branch; cross-module FKs deliberately deferred to root's integration sequencing (plain indexed columns + server-side validation instead); transport is documented visibility-aware polling (8s sync / 4s open-conversation, paused when hidden, 'Live' badge only on successful poll) with no WebSockets/fake presence claims; no operational mutation endpoints by construction; permission-aware event recipients reusing the `allow()` vocabulary with `UNIQUE(workspace,dedupe_key)` dedupe; attachments honest (503 when `env.BUCKET` unconfigured, magic-byte sniffing, no public URLs); supplier-only external threads reusing the existing supplier session resolution, buyer threads deferred. Items returned: hook wiring belongs to the integration owner (exact call sites go in the handoff report); reuse `inspection_photos` storage conventions; add offline/failure backoff to polling; `task_mention` must degrade honestly until production/sales task systems exist. Status: **written** (architecture accepted), implementation in progress.

## Update 3 — UI design milestone reviewed (28 Oct)

UI worker (`ctx_bae8a856c6c3`) delivered milestone 1/3 with 23 baseline "before" screenshots and `results.before.txt` as honest evidence. Verdict: **plan accepted with 3 conditions** (`msg_b662c61b6db1`): (1) file boundary — its brief owns `yarnflow.css` + presentational `SignIn`/`WorkspaceDashboard`/`LiveApp` only; the planned `LanguageSelect` restyle lives in shared `src/i18n.tsx`, so it must implement the segmented toggle inside owned files (or get root's explicit grant for that slice) and keep the storage key + aria-labels the e2e suite asserts, re-running `language-layout` and `interaction-foundation` specs as evidence; (2) contrast — the `>=4.5:1` claim must be shown with measured ratios for the warmed tints, not asserted; (3) reduced motion — the sliding pill/press feedback/notice slide must be actually disabled under `prefers-reduced-motion`, evidenced with matched after-captures. Palette direction preserves ink/focus/kraft tokens and keeps e2e-visible aria-labels; no new dependencies. Status: **written**, implementation in progress.

## Update 4 — sales + production architecture milestones and follow-up review (28 Oct)

**Sales** (`ctx_9fc971c271e8`, milestone 1/3): **accepted with 3 clarifications** (`msg_f594134abfb1`). Verified against the frozen contract: `sales_orders`/`sales_order_lines` verbatim with only allowed extra columns; buyer identities in a separate namespace (`buyer_users`/`buyer_sessions`, staff `users.name_key` untouched); terms immutability triggers throughout; invoice = `UNIQUE(workspace_id,number)` + `document_counters` upsert and invoice insert in one `db.batch()`, approval idempotent on revision (digest-checked) — worker reported a smoke test where racing/duplicate approvals return the same order + invoice `INV-2026-000001` (claimed **written+smoke-tested**, full suite due at milestone 2); Karachi due-date math as fixed UTC+5 (correct — Pakistan has no DST) with a Dec→Jan boundary test promised; outbox queued/failed/sent kept distinct. Clarifications returned: `salesScheduled` cron wiring belongs to the integration owner (`worker.mjs` is shared); state explicitly in the handoff whether invoice download is HTML-only (no PDF dependency); comment the UTC+5 assumption. Sales's error-code stance (stable English strings now, proposed code catalog in handoff, no shared-file edits) is the correct escalation vehicle.

**Production** (`ctx_c53aac1d4dd1`, milestone 1/3): **accepted with 2 additions** (`msg_1c5c5e64485a`). The consume/produce ledger mapping is the honest answer to yarn-to-cloth (no disguised waste/dispatch, real output lots, `lot→run→batch→sales_order_lines.id` traceability), with run-close reconciliation, 0003-style workspace triggers, capacity-unit-must-match-batch (409), transaction-guarded reservations, and an empirical FK/reversal rebuild check. Its formal proposal to extend `movements.action` CHECK was forwarded to root (`msg_82022901b3fe`); landing at integration still requires root's explicit approval. Additions returned: pin down the D1 transaction/PRAGMA interaction — `PRAGMA foreign_keys` cannot toggle inside a transaction and D1 may wrap migrations; recommended `PRAGMA defer_foreign_keys=ON` (D1-documented, node:sqlite-valid) or verification against real D1 in rehearsal; and make explicit who writes the cross-module `production_batches` dispatch status (reserved for sales; expected to be integration wiring).

**Follow-up reviewer** (`ctx_57881c4e50f7`) delivered commit `ca4698d` on `AnasTabba/erp-finish-review`: F1 reclassified P0→P1 fraud-prevention UX (root's challenge accepted; `UNIQUE(company name)` withdrawn as unjustified; approve-time collision display + `supplier.claim` audit linkage kept as recommendation); F2 P1→P2; F4/F6/F7 narrowed with exact mitigations; F3/F4 remain verified P1 gates; completeness matrix (6 domains) flags RFQ amend/cancel, landed-cost modelling, retest, count corrections, sales/credit returns as root decisions, not silent expansion; an 8-item P1 correction queue with exact owners. I verified no contract blockers remain beyond those root already owns.

Current wave state per reviewer: 0004/0005/0006 schemas + sales/buyer-portal/tracking server code written and honest fail-closed; no tests/UI yet at review time. All statuses in this report remain **written** unless labelled otherwise.

## Update 5 — root conditionally grants the consume/produce ledger extension (28 Oct)

Root's decision (threaded to `msg_82022901b3fe`): the `movements.action` CHECK extension with `'consume'`/`'produce'` is **CONDITIONALLY GRANTED** with four mandatory conditions, without which the extension stays blocked at integration: (1) migration rehearsal as a dedicated passing test on a copy of the 0000–0004 chain (counts, `foreign_key_check`, canonical write paths per `scripts/migration-rehearse.mjs`); (2) D1 pragma risk resolved to explicit proof — `defer_foreign_keys=ON` per D1-documented behavior verified in rehearsal, or a live run against real D1 showing rename+recreate+backfill succeeds; raw reliance on `PRAGMA foreign_keys` toggling inside a wrapped transaction is rejected; (3) both new actions exercised end-to-end by unit tests before the extension counts as landed; (4) no other 0005 contract additions ride along silently. Root also concurred that `production_batches` dispatch status names are reserved for the sales module: the cross-module transition is explicit integration wiring with the exact state mapping written out before integration, and neither worker may reuse the other's status values unilaterally. The completeness-review cross-cutting rows (RFQ amend/cancel, landed-cost modelling, retest, count corrections, sales/credit returns) are out-of-scope proposals requiring explicit user sign-off. Decision relayed to the production worker (`msg_72ee7e1117a8`).

## Update 6 — UI ownership boundary flagged (28 Oct)

The UI worker's uncommitted worktree includes edits outside its granted ownership: `src/i18n.tsx` (LanguageSelect rewritten from one toggle button into a `role=group` with EN/اردو buttons; aria-labels changed away from the pattern `e2e/language-layout.spec.ts` asserts) and `src/main.tsx` (figtree italic font import added). Both are shared files; the markup change would break the shared language-layout and interaction-foundation specs unless those are updated with it. Flagged to the worker (`msg_20a4d7adb117`: request root's explicit grant for exactly those two files + paired spec updates with a green e2e run, or revert) and to root (`msg_ccd3ca83553c`: grant or revert is root's call). The worker's `LiveApp.tsx` changes (glide measurement extended to `.live-segments`, a procurement page description with Urdu pairing) are presentation-only and within ownership. Wave status at this checkpoint: production building under the conditionally-granted extension; sales UI+client written; tracking has tests plus its own `scripts/migration-rehearse-0006.mjs`; chat has tests; all uncommitted, no gates breached so far. Statuses remain **written**.

## Update 7 — tracking architecture milestone verified (28 Oct)

Tracking worker (`ctx_37eb8c8ebbbe`) delivered milestone 1/3. Verdict: **accepted** (`msg_e01651f208dc`), with rehearsal evidence **independently verified by me**: ran `node scripts/migration-rehearse-0006.mjs` in its worktree — exit 0, all 27 baseline tables unchanged after 0006, all 11 tracking tables created and exercised through canonical module paths, `foreign_key_check` clean before and after; the rehearsal's single "provider call" is an injected fake fetch (no real HTTP, zero paid calls). Architecture highlights confirmed: account-scoped dedupe via `UNIQUE(account_scope, identifier_type, identifier)`; reservation convergence under concurrency via partial unique `(target_id,purpose) WHERE reserved`; ambiguous 200/timeout → `needs_reconcile`, never auto-retried (no double-charge); billing windows immutable and only extendable; `system` actor kept in its own `tracking_usage_events` ledger instead of touching the shared audit CHECK; ~30 stable error codes attached to `fail()` without editing shared renderers (integration's bilingual catalog maps on `code`); fail-closed until an admin records the real DataLoopLabs contract with attestation — **the actual vendor contract is NOT obtained** (no docs accessible without the paid account), so zero guessed endpoints and zero paid calls. Items for milestone 2: promised concurrency/clock tests, audit rows for admin actions, honest UI states, Asia/Karachi-consistent window math. Status: **written + rehearsal tested**; live tracking remains honestly unconnected.
