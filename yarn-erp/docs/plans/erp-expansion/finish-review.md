# Finish review and polish plan — Yarnflow ERP release + production/sales/tracking work

Date: 28 October 2026. Reviewed by the finish-review worker (task `task_ba58a95adbe8`; **revalidated** in the follow-up review, task `task_204aacfb8875`, 21:32–21:55 PKT — §0 Corrections records every changed claim).
Baseline read: `feat/erp-workflows` tip `166345a` (published release commit `f8c7fa4`, still an ancestor — app code unchanged since release).
Work-in-progress branches `AnasTabba/erp-production`, `AnasTabba/erp-sales`, `AnasTabba/erp-tracking` and `AnasTabba/erp-collaboration` are read only. **Correction of an earlier stale claim:** as of 21:32 PKT on 28 Oct the wave worktrees are no longer empty — uncommitted (untracked) wave drafts exist: `0004_sales.sql` + `server/sales.mjs` + `server/buyer-portal.mjs` (sales), `0005_production.sql` (production), `0006_tracking.sql` + `server/datalooplabs.mjs` + `server/tracking-budget.mjs` (tracking). No wave tests and no wave UI code exist yet. Statuses: **[live]** (implemented + covered by tests), **[branch-only]** (written in a wave worktree, uncommitted, untested), **[written]** (documented/planned only), **[gap]** (no implementation, no documented ownership).

Evidence test run in this clean worktree: `node --experimental-strip-types --test tests/*.test.ts tests/*.test.mjs` → **66 pass / 0 fail** (matches the release-note claim). Browser suites were not re-run; their case counts are taken from `docs/releases/2026-10-28-procurement.md`.

---

## 0. Corrections (follow-up revalidation, 21:32–21:55 PKT 28 Oct)

Root challenged the first review's P0 classification; each finding below was re-derived from the code, not re-asserted. Verification method: re-read every cited source line in the baseline worktree, re-ran the 66-test suite, read the complete uncommitted wave drafts, and checked root's supervision decisions (`erp-supervision/docs/plans/erp-expansion/supervision-report.md`).

1. **F1 re-classified P0 → P1 (fraud-prevention UX / procurement depth), owned by root — root's challenge accepted.** The original review called supplier-name duplication a security bypass. That is wrong: every approval path (`SupplierReview` `src/Procurement.tsx:60-65`, checkbox at `:63`) runs through a staff admin who must explicitly attest "I verified the company…", in an authenticated admin route with an audit event. Name duplication has **not** been shown to bypass the single-award-per-RFQ uniqueness — the award is database-guaranteed one per RFQ (`procurement_awards.rfq_id UNIQUE`, `drizzle/0002_procurement.sql:93-97`), so a duplicate supplier row does not produce two awards for one RFQ; it produces two addressable portal identities for one company (each duplicate row can bid separately via `supplier_bids UNIQUE(rfq_id,supplier_id)`, `0002:71`). The residual risk is human: an honest or negligent admin approving an impostor because the review form shows no name collision, no source-link comparison and no link to the directory entry. That is a fraud-prevention UX and procurement-depth gap (claim/merge workflow missing), not an unauthenticated exploit. The `UNIQUE(company name)` mandate is withdrawn as unjustified (duplicate legal names can be legitimate: same name multiple categories/agents). Kept as **recommendation**: approve-time collision display plus a `supplier.claim` audit linkage, decided by root at `implementation-plan.md:52`.
2. **F2 P1 → P2.** The claims were accurate but the severity over-stated them: unauthenticated `/api/auth/people` + name-keyed lockout enumeration costs an attacker ≈ days of continuous abuse for one PIN and a self-DoS only; seed shared-PIN is a documented rollout trade-off on a single-factory deploy. Correction to the wave-B concern: the buyer draft identities are **not** on the staff PIN path — `buyer-portal.mjs` uses its own 12-char-minimum password hashing, per-IP throttle and 15-minute lockout (`server/buyer-portal.mjs:13-22,66-82`) [branch-only, untested].
3. **F4 narrowed.** Client surfaces mitigate more than the first review credited: `IncomingStock.tsx:18-20` and `SupplierPortal.tsx:38` both compute and display "Remaining" client-side; only the staff orders view `Procurement.tsx:50` shows a bare status chip. The server-side defects stand as verified: `procurement.mjs:181-183` sets `status='dispatched'` unconditionally, and `receiving.mjs:46`'s reversal `CASE` does not recompute the received residual.
4. **F6 narrowed.** Client-thrown validation errors are already bilingual via `t('English','اردو')` call sites (e.g. `IncomingStock.tsx:26`). The leak is specifically **server-originated** prose: `fail()` copy is hard-coded English (`server/erp-utils.mjs:52-54`) and `errorMessage()` (`src/forms.tsx:5-9`) translates exactly one string.
5. **F7 narrowed.** Receipt→lot deep-links already exist [live] (`IncomingStock.tsx:20`). The genuine seam is PO→lot from the staff orders view and the forthcoming order→batch→sales-order lineage; the endpoint/component contract recommendation stands.
6. **Stale claims corrected in the header and §5:** wave worktrees DO contain code now (listed above, uncommitted); the earlier "quota exhausted / nothing written" state and the 29 Oct quota-reset framing are obsolete — the model is active and six workers (production, sales, tracking, finish review, UI finish, operational chat) are running per the collaboration state; the chat worker owns `0007_collaboration.sql` in the erp-collaboration worktree.
7. **F12 ownership memo added** per root: the `erp_audit_events.actor_type='buyer'` extension is owned by the sales migration worker; the production ledger rebuild (0005 preserves rows/FKs/triggers on migration — verified in `0005_production.sql`) is accepted as an integration rehearsal gate rather than a code defect.
8. **F3 and F4 remain the verified P1 wave gates** (accepted by root as actionable integration-owner corrections); F9 migration rehearsal is accepted as an integration gate; F12.1-3 fold into the sales gate list.

---

## 1. Verdict summary

The first release is structurally sound: the ledger, QC gates, supplier portal, awards, receipts and reversals are all real, race-checked and permission-gated [live]. The finish risk is not broken storage — it is trust at the edges (who is a supplier, who is staff, who approved what), product flow seams between domains (order → stock → buyer), and the state vocabulary of the new screens. After revalidation **no P0 stands**; the actionable verified P1 wave gates are F3/F4 (staff lifecycle audit, status honesty) plus the wave-B invariants in F12, with F1/F2 down-classified as root-owned fraud-UX guidance and rollout trade-offs respectively. The per-requirement completion matrix now lives in `completeness-review.md`.

| # | Item | Severity | Status | Where |
| --- | --- | --- | --- | --- |
| F1 | Supplier registration allows a same-name duplicate; approval relies on an admin attestation with no collision display or claim workflow (fraud-prevention UX) | **P1 rec** | gap, root-owned | `server/supplier-portal.mjs:34-48`, `drizzle/0002_procurement.sql:12-18`, `src/Procurement.tsx:60-65` |
| F2 | Staff identity: global user namespace + lockout-DoS + seed shared PIN (rollout trade-offs on a single-factory deploy) | **P2** | live, design choice | `server/auth.mjs:37-45`, `server/inventory.mjs:318-339` |
| F3 | Admin user lifecycle is un-audited (users create/update/remove; PIN reset) | P1 | gap | `server/inventory.mjs:364-408` vs `erp_audit_events` `0002:42-48` |
| F4 | PO/dispatch status overstates in the one staff view without a client-computed remaining; receipt reversal does not recompute the residual | P1 | live | `server/receiving.mjs:30,46`, `server/procurement.mjs:181-183`, `src/Procurement.tsx:50` |
| F5 | No PO cancel/close; RFQ stays `open` after deadline; supplier can't see dead RFQs close out | P1 | gap | `0002:56,96` status enums, no route sets cancelled/closed |
| F6 | Urdu leaks English **server**-originated validation/permission errors (client-side errors are bilingual) | P1 | gap | `server/erp-utils.mjs:52-54`, `src/forms.tsx:5-9`, `src/Procurement.tsx:27` |
| F7 | No cross-domain order timeline (PO→lot→batch→sales seam; receipt→lot deep-link already exists) | P1 | gap | `server/procurement.mjs:67-73`, `src/Procurement.tsx:50`, `src/IncomingStock.tsx:20` |
| F8 | No role-based home queue; dashboards are stock-only | P2 | gap | `src/LiveApp.tsx:319`, `src/WorkspaceDashboard.tsx` |
| F9 | No repeatable migration-rehearsal/back-recovery tooling in repo | P1 | gap | `scripts/` (no rehearsal script), release notes line 28 |
| F10 | Doc drift: PRODUCT.md claims photo upload "not implemented" | P2 | doc bug | `PRODUCT.md:40` vs `0000:70-75`, `server/inventory.mjs:154-192` |
| F11 | CSP/perimeter looseness for a production ERP (`frame-ancestors chatgpt.com`, `connect-src https:`) | P2 | live | `server/worker.mjs:17` |
| F12 | Financial-invariant seeds land with the sales wave (numbering, due dates, actor types) — actor extension owned by the sales migration worker | P1 | written-only → gate list | plan §33-35, `0002:42-46` |

---

## 2. Findings with evidence and acceptance scenarios

### F1 · Duplicate supplier registration has no collision display or claim workflow — **P1 rec** (fraud-prevention UX, root-owned; re-classified from P0)

**Correction of the first review.** The first review classified this as a P0 unauthenticated security bypass. Root challenged it; the challenge is accepted. Approval is not unauthenticated: every approve/reject/suspend runs through an authenticated admin who must explicitly attest "I verified the company, contact and selected yarn categories" (`src/Procurement.tsx:60-65`, checkbox `:63`) in an audit-gated route. A duplicate-name registration therefore needs **an admin to falsely (or negligently) attest verification** — a fraud-prevention UX problem and a procurement-depth gap (no claim/merge), not a demonstrated exploit. No reproduced bypass of award uniqueness exists: `procurement_awards.rfq_id` is `UNIQUE` (`drizzle/0002_procurement.sql:93-97`), so one RFQ still gets exactly one award even if the same company holds two supplier rows (each row may bid separately, `supplier_bids UNIQUE(rfq_id,supplier_id)`, `0002:71`). A `UNIQUE(company name)` mandate is **withdrawn** as unjustified (duplicate legal names can be legitimate); the plan's requirement is a *verified claim workflow* (`implementation-plan.md:52`), not a hard dedupe.

**What remains true [gap].** Registration captures company/contact/e-mail/phone as free text (`server/supplier-portal.mjs:34-48`) and always creates a *new* `suppliers` row; there is no company-claim workflow, no role-level `UNIQUE(workspace_id,name)` on `suppliers` (`drizzle/0002_procurement.sql:12-18` — the only UNIQUE is on portal `email`), and no e-mail verification step. Directory claims are manual per the release notes (`2026-10-28-procurement.md:20`), but the admin UI gives no way to *detect* or *merge* a duplicate claim: `SupplierReview` (`src/Procurement.tsx:60-65`) can only approve/reject/suspend a standalone record, and no `claim` endpoint exists in `supplier-portal.mjs` or anywhere else (verified by grep across `server/`). The approval-time consequence is real: an admin who approves a duplicate row publishes later RFQ contents for that category to the duplicate's portal inbox (RFQ rule targets category-approved suppliers, `procurement.mjs:93-96`), so contact identity confusion — not award duplication — is the harm.

**Reproducible scenario (fraud attempt blocked only by admin diligence).** 1) Admin adds directory contact "ABC Mills" with `source_url=https://abcmills.example` (`status='directory'`). 2) A registrant registers with company "ABC Mills", any e-mail and phone. 3) Admin opens Review on the *new row* (`src/Procurement.tsx:37` lists both rows side by side with no linkage or warning between them), checks the attestation box (`:63`) and approves. 4) A published cotton RFQ's contents are delivered to the impostor's portal inbox (`procurement.mjs:93-96`). No audit hook flags the duplicate name.

**Acceptance test (for the recommendation, root-owned).** Repeat steps 1–2; the review form **must** show the colliding directory entry next to the registration (name + verified source link + who recorded it) before the attestation box can be checked; approving a duplicate registers a `supplier.claim` audit event linking `supplier_id`↔directory id (or the admin rejects with reason "duplicate of directory entry"). Publishing addresses suppliers by their linked directory identity. Fixture: the existing test "duplicate registration cannot claim its company" (`tests/procurement-api.test.mjs:124-128`) covers only same-e-mail replay (409 on second register with the same e-mail) plus login lockout — extend it to the name-collision approval case above.

**Minimum fix (recommended, root decides depth/timing).** a) Approve-time collision display in `SupplierReview` when `SELECT … FROM suppliers WHERE lower(name)=lower(?)` matches (pure query, no migration); b) `supplier.claim` audit event + optional `linked_directory_id` in the review payload (additive migration under F9 discipline); c) a decision on the fuller claim workflow belongs to procurement depth planning, not the release gate.

### F2 · Staff account perimeter — **P2** (documented trade-off; re-classified from P1)

**Observation [live, working as designed; the claims are accurate, the severity was not].**
- Names are globally unique (not per workspace): `users.name_key TEXT UNIQUE` (`drizzle/0001_users.sql:11`) and login resolves by name only with no workspace filter (`server/inventory.mjs:331`). Currently harmless (one factory), but a second factory deploy would silently break sign-up for colliding names (`inventory.mjs:357`).
- `/api/auth/people` (`inventory.mjs:318-321`) posts the complete active staff list and workspace name without authentication; the lockout (5 wrong PINs → 5 min, `auth.mjs:6-7`, reset counters `inventory.mjs:338`) is *enumerable per name*: an attacker can keep every admin in permanent 5-minute lockout (self-DoS only), and 4-digit PIN space with 4 tries per lockout cycle has an expected cost of ≈ 1 250 cycles ≈ 4 days of continuous abuse for one account. There is no per-IP throttle on this path (contrast with the supplier portal's `throttle()` `supplier-portal.mjs:19-23,51`).
- Seed admins share one starting PIN (`auth.mjs:37-45`, docs `seed-users.mjs`). Combined with a fast 4-digit SHA-256 hash (`auth.mjs:1-4,12-14`, explicitly documented trade-off), a leaked D1 export is instantly brute-forceable.

**Why P2, not P1.** Every element is a deliberate, documented single-factory rollout trade-off: no multi-tenant reality yet, an attacker gains nothing but denial for a multi-day idle-attack it would surely notice, and the shared PIN is operationally chosen. It does not break a release flow or corrupt data. It becomes P1 material the moment a second factory or external admin accounts exist.

**Acceptance scenario (test the tightening, once written, works).**
1. With `throttle()` applied to `/api/auth/login`, 31 attempts from one IP in 15 min → 429 before lockout cycles trigger.
2. Changing any admin PIN rotates the other two seeds only via explicit admin action, and the audit trail (F3) records who reset which account.
**Recommendation (unchanged in substance).** Add the portal's per-IP throttle to `authRoute` login+signup, require PIN rotation ≥ 6 digits for newly created `role='admin'` accounts (leave the 4-digit worker PIN UX as is), and treat the 4-digit PIN as a lock, not the key. The wave-B concern from the first review is resolved in the sales draft: buyer identities are **not** on the staff PIN path — `buyer-portal.mjs` registers its own 12-char-minimum hashed passwords with per-IP throttle and a 4-failure/15-minute lockout (`server/buyer-portal.mjs:13-22,66-82`) [branch-only, untested]. Buyer identities also never enter the staff `users`/`name_key` namespace: they live in `buyer_users` (`0004_sales.sql`).

### F3 · Admin user lifecycle has no audit events — P1

**Observation [gap].** `erp_audit_events` is written for supplier/bid/RFQ/receipt actions (keyed by `actor_type` `staff|supplier`, `0002:43-46`) and is append-only (`0002:47-48`). But every internal-account mutation — creating a user, granting permissions, promoting/demoting admins, resetting a PIN (which drops sessions), removing a person, approving a pending account — runs inside `usersRoute` with **zero** audit rows (`server/inventory.mjs:364-408`).
**Why it matters for the finish review's mandate.** "Staff versus supplier identity" needs an answer to "who changed whose access?" The examiner-facing story the release already tells ("auditable reviews") is incomplete for staff.
**Reproducible scenario.** Admin A resets admin B's PIN (`src/Team.tsx:145-147` → `/users/update` with `pin`) then demotes every other admin. Database shows sessions deleted and role changed but no actor attribution anywhere outside the `users.created_by` field (which only covers creation).
**Acceptance test.** For each of {create, update(role/status/permissions), update(pin), remove, approve-request} assert exactly one new `erp_audit_events` row with the acting user id and the changed fields; add to `tests/inventory-api.test.mjs` next to the "admins add, promote, reset" test (`:118`).

### F4 · Purchase-order status labels can lie during partial flows — P1

**Observation [live, narrowed].**
- Any successful dispatch notice sets the PO straight to `status='dispatched'` regardless of partial quantity (`server/procurement.mjs:181-183`); the quantity is bounded only cumulatively by the DB trigger (`0002:111-118`), which is good. The first review overstated the UI blast radius: two of the three surfaces already mitigate — `IncomingStock.tsx:18-20` and `SupplierPortal.tsx:38` compute and show "Remaining …" client-side, so a 1 kg dispatch of a 10 t order *overstates only in the staff orders view* (`Procurement.tsx:50`, which shows just the status chip).
- Reversing the last receipt flips the PO label back with a `CASE` to `accepted`/`dispatched` without recomputing the actually-received residual (`server/receiving.mjs:46`): a partially-received order (receipts A 4 t of 10 t + receipts B 6 t → `received`; reverse B) reads `accepted`, though 4 t remain received and bound. Supervisor-verified.
- Positive precedent in the sales draft (uncommitted): `sales.mjs:307-310` recomputes the order's `dispatched`/`partially_dispatched` status from shipment sums excluding reversed movements inside the same batch — the pattern F4's fix should copy on the procurement side.
**Acceptance scenario.** Make an RFQ 100 000 milli-kg, award it, post a shipment of 1 000 milli-kg → staff orders view must read "Partially dispatched (1%)", not "dispatched". Post receipts 60 000 then reverse them → status must return to `accepted` with "Received 0 / 100" showing, and to `accepted · Received 40` in the mixed case above (derive from `goods_receipts − receipt_reversals`, as `tests` do).
**Minimum fix:** derive status chips (`dispatched_full|partially_dispatched|partially_received|received_full`) from the tables in the API response, e.g. compute `received_milli`/`shipped_milli` in `receiving.mjs:8-12` and `procurement.mjs:70-72` list queries, keep the stored enum for lifecycle state while the derived field drives the label. This is what wave-B "connected order timeline" will consume.

### F5 · Dead-end states: POs can never be cancelled; expired RFQs stay 'open' — P1

**Observation [gap].** The schema defines `cancelled` for POs and `closed` for RFQs (`0002:56,96`) but no route or UI action sets either. A wrong award, a payment default, or a logistics shock must be closeable without destroying history. Also RFQs stay `open` after their deadline with the award button guarded only in the bid card.
**Acceptance scenario.** Admin cancels an awarded PO with an audited reason → supplier's portal shows "Purchase order cancelled" state (not a 404), the RFQ shows `closed`, additional dispatches are blocked by the trigger (already true — extend test `procurement-api.test.mjs` "expired deadlines…" `:118`). Payment-time cancel must *not* be allowed once a goods receipt exists (`goods_receipts` guard like `receiving.mjs:86` does for movements).

### F6 · Urdu mode leaks English server errors — P1 (narrowed to server-originated copy)

**Observation [gap, narrowed].** The first review implied *all* ERP errors are untranslated — that is wrong. Client-thrown validation errors are already bilingual through `t('English','اردو')` call sites (e.g. `IncomingStock.tsx:26`). The leak is exactly **server-originated** prose: `errorMessage()` (`src/forms.tsx:5-9`) translates only one server message by string match, while `fail()` copy is hard-coded English (`server/erp-utils.mjs:52-54` "Your account does not have permission…", `receiving.mjs:32,48`, `procurement.mjs:183`), and every screen renders server errors through `t(error)` with no catalogue (`src/Procurement.tsx:27`, `src/SupplierPortal.tsx:27`, `src/IncomingStock.tsx:16`). On phones where the Urdu operator is the actual shop floor user, a server rejection guides nothing.
**Acceptance scenario.** Urdu + a member lacking `receive` tries to record a receipt → screen shows an Urdu sentence as specified, not the English `allow()` copy. Implementation: switch `fail(403|409|422, …)` call sites used by user-facing flows to stable error codes (`{ code: 'PERMISSION_REQUIRED', params }`) rendered through a bilingual dictionary in `src/ui-copy.ts`; keep English strings for the API tests (assert on code, not prose).
**Note:** existing UI state machinery is good [live]: skeleton `role="status"` loading lines, `role="alert"` errors with retry, `live-muted` empty states (`Procurement.tsx:27,35,43,49`, `LiveApp.tsx:245-251,315-317`). New wave screens must inherit — make it a review checklist item, not rework.

### F7 · No cross-domain order timeline — P1 (design the contract now)

**Observation [gap, narrowed].** The first review said "nothing finds an order's lots today" — overstated: the incoming-stock view already deep-links each receipt to its lot (`IncomingStock.tsx:20`) [live], and per-lot steps live in `LotDetail` (`LiveApp.tsx:124-131`). The real seams: the staff orders view does not link a PO to its receipts/lots (`Procurement.tsx:49-51` shows lists only), `LotDetail` is not connected from POs, and the coming batch→sales-order lineage (`0005` produces batches referencing `sales_order_lines`) has no shared surface. The plan already requires "each order page has one timeline" (`implementation-plan.md:173`).
**Recommended contract (write it before wave A/B integrate, so routing lands once).**
1. `/api/erp/orders/:supplier/poId/timeline`-style endpoint per order family (supplier PO and later buyer order) that unions rows from `procurement_rfqs, supplier_bids, supplier_purchase_orders, procurement_shipments, goods_receipts(+reversals), movements, [0005: production_batches, outputs], [0004: sales_orders, invoices, payments]` into `{ ts, actor, kind, detail, lot_id? }` rows, workspace-scoped.
2. One reusable `<OrderTimeline rows=… />` client component (extend the existing `yf-timeline` CSS and `activityList` pattern, `LiveApp.tsx:283-288`) rendering receipt/dispatch/batch/production/invoice nodes; batch rows that carry a lot id deep-link via the existing `YF:<id>` lookup.
3. Each supplier PO card gets "Open batch" when a receipt exists (`IncomingStock.tsx` already knows the lot id — replay it, don't recompute).
**Acceptance test (wave A+B integration).** From one awarded RFQ: award → dispatch → receipt → (wave A) batch consumes the lot → (wave B) buyer invoice — the timeline shows all six events in one place for both a staff member (`procure`) and later the buyer portal; `e2e/procurement.spec.ts:5` extended to assert ≥ 5 timeline nodes after receipt.

### F8 · Role-based action queues — P2 polish for home

**Observation [gap].** Home is stock-only for everyone (`LiveApp.tsx:319` → `WorkspaceDashboard`). The right pattern already exists on batch pages: "the next step" widget with permission-aware copy (`LotDetail` next/`steps`/`whoCan` block `LiveApp.tsx:136-145`). Role queues need not be built by the domain workers; they are integration-owner/UI-worker work.
**Recommended minimal queue (acceptance-checked, not decorative).** Home lists at most one card per permission family with real pending data (never a demo row):
- `receive|procure`: "2 POs await receipt" from `supplier_purchase_orders` status `accepted`/`dispatched` (counts from `/api/erp/inbound`, not a new query first).
- `qc|inspect`: "3 batches need inspection/QC" from `lots.quality='uninspected'|'hold'`.
- `suppliers`: "1 registration awaiting review" — the `pending` supplier count (mirror of the staff `pending` count the dashboard already fetches `inventory.mjs:74`).
- `dispatch`: "4 t approved finished stock not yet dispatched" from balances stage `finished`/`cops`.
- Post wave B: "1 invoice awaiting settlement / 2 deliveries today".
Each card is a link, tapping opens the existing list; zero data → the card is hidden, not a grey "no items" row. This distinguishes implemented behavior (today: none) from recommendation.

### F9 · Migration recovery runbook is not reproducible in-repo — P1 (accepted by root as an integration gate)

**Observation [gap].** The release notes describe a manual rehearsal on a private DB export ("row counts preserved, FK checks passed" — `2026-10-28-procurement.md:28`) and the parallel plan requires it again for 0004/0005/0006 plus a "carefully rehearsed table rebuild…release gate" (`parallel-implementation-plan.md:21,30`). But the repo ships no script that performs that rehearsal: `scripts/` has only setup/seed/demo tools. Precedent exists that makes this *harder* for 0005: `0003` already replaces `validate_movement` (`drizzle/0003_purchase_receipts.sql:27-32`), so wave A's conversion-ledger extension must repeat that dance with live rows present. **Revalidation note:** the production draft `0005_production.sql` does preserve rows/FKs/triggers inside its ledger rebuild (verified by reading the migration), so this is a gate on process/tooling, not an observed defect in the draft.
**Recommendation + gate.** Add `scripts/migration-rehearse.mjs` that: (1) loads a fresh D1 export/fixture; (2) records baseline counts for every table; (3) applies each migration; (4) re-counts and diffs, runs FK `PRAGMA foreign_key_check`; (5) exercises ~10 canonical write paths through the API against the migrated DB (same list as `tests/inventory-api.test.mjs` fixtures); (6) prints pass/fail. Acceptance: the script runs green locally in <2 min and is committed before 0004/0005 are applied to any shared staging data; the wave-A table rebuild needs an equivalent "preserve rows/FKs/triggers" assertion.

### F10 · PRODUCT.md drift — P2 (report only; not edited under my ownership)

`PRODUCT.md:40` still says "Inspection photo upload is not implemented yet", but photos are live: `inspection_photos` table (`0000:70-75`), the upload/proxy path (`server/inventory.mjs:154-192`), the lot evidence gallery (`LiveApp.tsx:162`), and the test "inspection photos persist independently of the device" (`tests/inventory-api.test.mjs:256`). Flag to the owners maintaining PRODUCT.md; examiner-facing contradiction, not a code bug.

### F11 · Worker perimeter header hygiene — P2

`server/worker.mjs:17` ships `Content-Security-Policy` with `connect-src 'self' https: …` (any HTTPS host; scanner proxy is server-side so the browser does not need `https:`) and `frame-ancestors … chatgpt.com`, which allows later iframe embedding of an app carrying session cookies; also `unsafe-inline` styles. Low risk today (SameSite=Strict blocks cross-frame cookies), but tighten to a fixed allow-list (scanner host moved server-side by the tunnel proxy already — surface it to the supervisor: no browser-to-scanner direct call remains, so `connect-src` can be `'self'`).
**Acceptance:** CSP diff ships with the wave integration; the live app's scan flows pass e2e unchanged.

### F12 · Financial invariants to land with the sales wave — P1 gates (written input into 0004)

State to build from (not new invention — these are the plan's own requirements tightened to test form):
1. **Invoice uniqueness:** `UNIQUE(workspace_id, number)` on `invoices` + a `document_counters` table; counter increment and invoice insert in the same `db.batch()`; buyer-approval endpoint must be idempotent on `(order_id, revision)` so "duplicate approval produces one invoice" (`plan §31,193`). A number burn test: two racing approvals → one invoice, next number has no gap cover requirement (gaps allowed on rollback; assert *no duplicates and no reuse*).
2. **Due-date math:** `due = confirmed_delivery_ts (+30 days)` computed server-side in Asia/Karachi; UTC+month/year boundary cases 31 Dec → 30/31 Jan asserted in tests (package `factoryInput` precedent `src/erp-client.ts:39-42`). Delivery-date corrections recompute only via the audited correction path (plan §104).
3. **Money:** integer minor units + explicit currency (`plan:37`); no mixing of currencies in a receivable; reminder dedupe through `UNIQUE(receivable_id, reminder_type, due_revision)` (plan §105).
4. **Actor typing:** wave B portal actors need `erp_audit_events.actor_type` extended (`supplier|staff|buyer`) — rehearse the additive `CHECK` migration in the same F9 gate. **Ownership (root decision):** the `buyer` actor extension is owned by the sales migration worker; note the sales draft already stores buyer/purchase-order provenance via `actor_type` columns on domain rows (`0004_buyer_purchase_orders`, `sales/buyer-portal.mjs:109-110` uses `actor_type='buyer'` without touching `erp_audit_events`) — safe interim, but the audit-stream extension remains a gates item.
5. **Production↔sales FK guard:** `production_batches.sales_order_line_id` must be validated workspace-scope like receipts do (`0003:13-21` pattern) — cross-workspace lines are the classic leak here.
6. **Conversions:** wave A must not add a kg↔metre "exchange rate"; conversion factors live on the product spec, used per run, with consumed grams and produced metres recorded separately. Add a domain test: consuming 1 000 g cannot produce a round "10 m" unless the spec factor approved by an admin is recorded (`plan:21,132`).

---

## 3. Product finish plan (recommended, distinguish from implemented)

**Implemented [live] and to preserve as the baseline pattern:** permission-aware UI with explicit "who can do this" copy (`LiveApp.tsx:143-145`); skeleton loading + error retry + empty states (`Procurement.tsx:27` etc.); the two-step review-before-save form (forms.tsx `AsyncForm`); draft persistence with failure notice (`LiveApp.tsx:49,76`); offline banner + "safe on the server" copy (`LiveApp.tsx:316,251`); undo via reversals (`LiveApp.tsx:317`); Urdu RTL with LTR bounds for identifiers (`i18n.tsx:33-36`, `ErpCommon:43`, 44px+ touch targets asserted by `e2e/interaction-foundation.spec.ts:129`); safe-area tokens for RTL (`:237`).

**Recommended additions (integration owner + UI worker owning presentation files, no simultaneous edits in other branches).**
1. *Role queue cards on Home* (F8) — one pass, static data sources already served.
2. *Order timeline* (F7) — endpoint + component shared by procurement orders, incoming batch detail, and later `sales/orders/:id`.
3. *Bilingual error catalog* (F6) — replace `t(rfc prose)` with code-keyed dictionary; affects all wave screens, so it must land before wave A/B UI, or in the same integration commit.
4. *Status-chip honesty* (F4/F5) — derived labels + cancel/close action with reason; no new screens.
5. *Mobile Urdu pass for new screens* — extend `e2e/language-layout.spec.ts` pattern (Urdu render of every new screen, zero horizontal overflow); every trigger confirm checkbox ≤ 2 lines.
6. *Loading/empty parity checklist* — each new wave screen must show: loading (`role=status`), empty (`live-muted` + one action), error (`role=alert` + retry), saving (disabled+spinner), saved (notice + undo where applicable), permission-denied (who-can copy). Written as the final acceptance gate in §4.

---

## 4. Integration release gates (sequence, owner, evidence)

| Gate | Owner | Evidence to file before proceeding |
| --- | --- | --- |
| G1 — Finish-review findings P0/P1 resolved or accepted | this review + coordinators | linked PR/commits in `0004/0005` worktrees or acknowledged deferrals |
| G2 — Supplier collision display + claim linkage shipped (F1 rec, root-owned; recommended before wide roll-out, not a release blocker by root decision) | root / wave-A owner | new fixture `duplicate name-collision approval` red→green; approve-time collision query shipped |
| G3 — Rehearsal tooling (F9) | integration owner | `scripts/migration-rehearse.mjs` green on pre-migration fixture; counts + FK check output pasted into the wave report |
| G4 — Wave A contract: `0005` accepted | integration owner | production migration SQL reviewed against this file's §2-F7/§4 gates; `0005` never creates a placeholder conversion |
| G5 — Wave B contract: `0004` accepted | integration owner | invoice/due-date/dedupe invariants §F12.1-3 asserted by red→green fixtures; `erp_audit_events.actor_type='buyer'` extension owned by the sales migration worker (§F12.4) |
| G6 — Cross-workspace isolation sweep | integration owner | every new route tested with a second workspace admin receiving 401/404, matching `tests/inventory-api.test.mjs:213` style |
| G7 — Usability + safety | UI worker / advisory supervisor | every new screen passes loading/empty/error/save/permission checklist §3.6; Urdu overflow e2e; keyboard reachability on phone screens |
| G8 — Timelines + queues integrated (F7/F8) | integration owner | e2e from award to invoice shows one timeline; home queue shows live counts in Urdu mode |
| G9 — Release rehearsal before deploying merge | coordinator | rehearsal script output on a clone, both domain test suites 100% green, browser smoke from `docs/phone-test-set.md`; publish only after G5-G8 |

---

## 5. Setup dependencies and honest blockers

- **Worker quota (corrected):** the first review reported both wave dispatches as failed on model quota with nothing written. Both claims are obsolete as of 21:32 PKT 28 Oct: the configured free model is active again, six workers are running per the collaboration state (`parallel_implementation_active` — production, sales, tracking, finish review, UI finish, operational chat), and uncommitted wave drafts exist (header list above). Scheduler-heavy waits remain a risk; the model's same-day message cap could still throttle later workers — treat availability as a planning risk, not this review's blocker.
- **Operational chat worker (new):** dispatch `ctx_297c6b873185` in the erp-collaboration worktree owns `0007_collaboration.sql`; guidance says it must not weaken the audit `actor` checks. Included in the completeness matrix as a new requirement row.
- **DataLoopLabs:** no API contract was verified from the account's own documentation; no paid call has been or should be made by any worker until the contract and a written allowance exist. Tracking stays explicitly "not connected" in the live UI [live, honest stop — `procurement.mjs:72`, `Procurement.tsx:50`]. The uncommitted tracking draft (0006 + `datalooplabs.mjs` + `tracking-budget.mjs`) is fail-closed by design: it refuses to call the provider until an admin records and attests the account contract, redacts the credential from every stored/logged string, parks ambiguous outcomes for manual reconciliation instead of retrying [branch-only, untested].
- **E-mail sending domain:** RFQ/invoice delivery remains portal-inbox only. Corrected detail: the sales draft queues email messages in `sales_outbox`, records each failed attempt with its error, and honestly reports "Email sending is not configured for this factory. The message stays queued." (`sales.mjs:66-75` [branch-only]) — it never pretends a send happened. Supplier directory claims still need the manual admin verification step humans must staff (F1 fix reduces but does not remove that burden).
- **PRODUCT.md** needs a refresh by its owner (F10) — outside my file ownership.

## 6. What this review did not do

No app code, migrations, PRODUCT.md, shared files or other worktrees were modified; the only files changed on branch `AnasTabba/erp-finish-review` are this document and `completeness-review.md`. Local-only unit tests were run (66 pass); no Cloudflare deploy, no live-DB writes, no model/host changes, no paid API calls. Wave worktrees were read only — their uncommitted drafts were inspected to classify status and catch draft defects, never edited.
