# Factory Portal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rework the Yarnflow ERP branch into the factory-side Textile Factory Portal: six server-enforced roles, an append-only audit log, admin thresholds with a generic approval engine, notifications and reminders, the procurement → QC → inventory → sales → invoice → dispatch → payment flow, an authenticated integration API for the separate supplier and buyer portals, and one set of screens per role.

**Architecture:** The existing Cloudflare Worker (`server/*.mjs`, dense ESM) and D1 database stay. New behaviour lands as additive migrations `drizzle/0005`–`0018` and small domain modules mounted under `/api/erp/<domain>/*` by `server/inventory.mjs`. Cross-cutting rules live in shared helpers: `role()`/`viewer()` (RBAC + admin intervention), `audit()` (append-only log), `needsApproval()`/`approvalQueries()` (thresholds), `notifyRole()` (notifications). The React app keeps the Cone Code shell in `src/LiveApp.tsx`; its navigation is driven by the signed-in role.

**Tech Stack:** React 19 + Vite + TypeScript, Cloudflare Workers + D1 (SQLite) + R2, `node:test` with `node:sqlite` (`server/sqlite.mjs` as the D1 stand-in), Playwright for e2e, lucide-react icons. No new dependencies.

**Spec:** `yarn-erp/docs/specs/factory-portal-spec.txt` and `yarn-erp/docs/specs/factory-portal-decisions.md` (binding together). UI rules: `yarn-erp/DESIGN.md`.

All paths below are relative to `yarn-erp/` unless they start with `/`. Run every command from `/Users/anastabba/Documents/iba/sem7/FYP-factory/yarn-erp`.

## Current state

Baseline at `4212ef5` (`npm test` 76/76, `npx tsc -b` clean). The live D1 `yarnflow-db` has migrations `0000`–`0003`; `0004_sales.sql` is committed but not applied there, so sales and the buyer portal have never been live.

| Spec section | Exists | Must change | Must remove |
|---|---|---|---|
| 0.4 RBAC, 3 Roles | `users.role` admin/member + 13 JSON `permissions`; `allow()` in `server/erp-utils.mjs`; admin-only `usersRoute` in `server/inventory.mjs` | Six roles in a `roles` table and `users.portal_role`; every route checks role on the server; existing users migrated | Self sign-up (`/api/auth/signup`, `SignIn.tsx` request step), permission presets (`src/Team.tsx`), `PERMISSIONS`/`allow()` |
| 0.5, 2.3 Audit log | `erp_audit_events` with no-update/no-delete triggers; `audit()` helper (actor, action, record, detail) | Add role, object type, old/new values, reason, intervention reason; DB trigger refuses rejection-type rows without a reason; admin viewer | Raw `INSERT INTO erp_audit_events` in `procurement.mjs` |
| 0.6 Reasons | Some routes require `reason` (supplier review, bid reject, reversals) | One `reason()` validator (5–1000 chars) on every rejection, dismissal, hold, override, intervention; DB triggers as a second guard | — |
| 0.7 Tracking key | `procurement.mjs` returns `tracking:{configured:false,provider:'DataLoopLabs'}`; uncommitted fail-closed adapter `server/datalooplabs.mjs` in `/Users/anastabba/orca/workspaces/FYP/erp-tracking-dll/yarn-erp` | Copy the adapter verbatim; key in Worker secret `DATALOOPLABS_API_KEY`; cached last status per shipment | The 1,000-line budget/credit-reservation layer from that worktree is not brought over |
| 2.1 Authority chain | Admin flag only | `role()` blocks other roles; admin acting outside admin scope must give an intervention reason; decided items are final (DB triggers) | — |
| 2.2 Thresholds | None | `thresholds` + trigger-written `threshold_history`; at or above = pending admin approval | — |
| 2.4/6 Notifications | Only `sales_reminders` (receivables) | One `notifications` table, per-user inbox, the 23 notification events | `sales_reminders` writes |
| 2.5 Reminders | Daily cron for receivables only | Hourly cron; pending items older than `reminder_hours` (default 24) remind the responsible role once | — |
| 4.1 Suppliers | `suppliers` (directory/pending/approved/rejected/suspended/archived), 6 yarn categories, admin-only review, staff can add directory contacts | Purchase Manager reviews; dyes/chemicals/packaging categories; ratings; profile | Staff supplier creation (`POST /api/erp/suppliers`) |
| 4.2 RFQ and bidding | `procurement_rfqs` draft/open/awarded/closed, publish to approved registered suppliers, bid reject with reason | Manual end, auto-end at deadline (cron), cancel (reason), recipients no longer need portal accounts | — |
| 4.3 Award and PO | `/api/erp/bids/award` creates `supplier_purchase_orders` at once | Purchase threshold gate; PO quantity/total columns; PO quantity change re-approval; B/L on PO | — |
| 4.4 Shipment tracking | Supplier-entered `procurement_shipments` (immutable, `tracking_status='not_connected'`) | PM enters B/L; `shipments` table with last status, last checked, last error | Supplier dispatch notice route (`/api/portal/dispatches`) |
| 4.5 QC and supervisor review | `inspections` (label/scan note), one photo per inspection in R2, lot `quality` approve/hold | Lots linked to PO/shipment/supplier; accepted/rejected quantities; mandatory photos; issues; supervisor accept/reject/confirm/dismiss/escalate | `/api/quality`, `/api/inspections`, `/api/photos` POST, goods receipts (`server/receiving.mjs`, `/api/erp/inbound`, `/api/erp/receipts*`) |
| 4.6 Claims | None | `claims` with auto amount, claim threshold, admin outcome and adjustment | — |
| 4.7 Inventory | Movement ledger (`movements`, `stock_deltas`, `balances`) with immutability and non-negative triggers; anyone with a permission moves stock | Supervisor only; type + source on lots; adjustments/write-offs with reason and threshold; deduction at dispatch | `/api/movements` POST, `/api/reversals`, `/api/lots` POST, stage-transfer UI |
| 4.8 Buyer RFQ → invoice | `buyers` (pending/active/…), `buyer_purchase_orders` (= buyer RFQs), versioned quotes, buyer approval mints order + invoice at once, invoices immutable, `INV-YYYY-NNNNNN`, no tax | Sales Manager reviews buyers; held RFQs; auto-close on rejection; separate "note sale"; 18% GST, `INV-YYYY-NNNN`, PKR from settings; credit notes | Staff buyer creation, staff RFQ entry, outbox, `confirmApprovedRevision` |
| 4.9 Payments | Delivery-based `receivables`, `sales_payments`, reminders | Invoice-level due date, partial payments, statuses unpaid/partially paid/paid/overdue, 7/3/0/overdue alerts | Delivery/receivable routes |
| 4.10 Dispatch | Immediate `sales_dispatches` (stock deducted at once) | `dispatches` lifecycle, approval requests, holds, stock issues; reuse `sales_dispatches` insert at "dispatched" | Immediate dispatch route |
| 5 Entities | Most procurement/sales tables | New: roles, thresholds, threshold_history, settings, approval_requests, notifications, supplier_ratings, shipments, qc_lots, qc_inspections, qc_photos, qc_issues, claims, inventory_adjustments, stock_queries, supervisor_reports, quotation_acceptances, credit_notes, invoice_payments, credit_alerts, dispatches, dispatch_requests, stock_issues | No data table is dropped |
| 7 Analytics | None | Admin, sales, purchase endpoints and screens | — |
| 8 Screens | `LiveApp.tsx` tabs: Home, Stock, Scan, History, Procurement, Sales, Team, Settings, Help | Role-driven navigation; per-role screens; Notifications; My profile | `Procurement.tsx`, `IncomingStock.tsx`, `Sales.tsx`, `sales-client.ts`, `Team.tsx` |
| 9 Integration | Browser portals with their own password sessions (`server/supplier-portal.mjs`, `server/buyer-portal.mjs`) | Token-authenticated `/api/integration/v1/*` intake and outbound endpoints reusing the validators and bid logic | Both portal modules, `src/SupplierPortal.tsx`, `src/BuyerPortal.tsx`, `#/supplier` and `#/buyer` routes, `e2e/procurement.spec.ts` |
| 10 Out of scope | `production` permission label in `Team.tsx` only (no planning code); scanner (`Scanner.tsx`, `/api/v1/*`) is not a listed exclusion | — | `production` label goes with `Team.tsx` |

`src/App.tsx` (4.7k lines) is not imported anywhere; this plan leaves it untouched.

## Global Constraints

- Roles are exactly: `admin`, `purchase_manager`, `quality_inspector`, `supervisor`, `sales_manager`, `dispatch` (spec 1, 10). No other role, permission flag or preset in the final system. Temporary rollout exception (F1): the role-derived `ROLE_PERMISSIONS`/`allow()` shim survives only until Task 22; it never authorizes a legacy mutation that a new backend invariant has superseded.
- "Enforce permissions on the backend (role-based access control). Hiding buttons in the UI is not enough." Every `/api/erp/*` route calls `role()` (writes) or `viewer()` (reads) from `server/erp-utils.mjs`.
- "Every decision, approval, rejection, override and threshold change must be written to an audit log." Write the audit row in the same `db.batch` as the change.
- "Any rejection, dismissal, override or intervention requires a reason. The system must refuse to save it without one." Use `reason()` (5–1000 characters, 422 otherwise). Holds and suspensions count as rejections.
- Every write route's `keys()` allow-list includes `interventionReason`. When an admin calls a route owned by another role, `role()` requires it and the audit row stores it in `intervention_reason`.
- "Keep the API key for the shipment tracking service on the server only." Secret name `DATALOOPLABS_API_KEY`; it never appears in a response, a stored row or a log line.
- Thresholds: "Below the threshold: the acting role's decision is final. At or above it: the item stays in a 'pending admin approval' state and takes no effect until admin approves." A threshold the admin has never set is "not configured": the acting role's decision is final, exactly as before this plan, and the admin dashboard lists unset thresholds (Task 18), per controller ruling F21. Decided records and their audit history stay immutable even for admins; a correction is a new reasoned compensating action through the owning route, linked to the original item, and subject to the usual thresholds. Owning write routes accept optional `compensatesId` for admin compensations, validate the original belongs to the workspace, require a reason and intervention reason where applicable, and store the original id in the new audit detail; compensation never updates the original decided row.
- Legacy raw/cops/WIP/finished balances remain readable; new workflows write only raw and finished. Raw sale dispatch returns 422 with a clear explanation; cops/WIP are read-only pending an explicitly authorized migration outside this plan (F24).
- Money is integer minor units (paisa); quantities are `quantity_milli` in a declared unit; mass is integer grams; times are epoch ms; calendar dates are Asia/Karachi via `karachiDate()`/`dueAt()` in `server/sales.mjs`.
- Invoice defaults (decisions 2): currency `PKR`, tax 18% GST on the subtotal (`tax_rate_bp = 1800`), number format `INV-{YYYY}-{NNNN}` resetting each Karachi calendar year; all three admin-editable. The factory currency also applies to bids, quotations and monetary thresholds. Currency changes return 409 while open bids, unaccepted quotations or unpaid invoices exist; never compare unlike currencies, and group historical analytics totals by currency (F20).
- Reminders: 24 h default, admin-configurable (`reminder_hours`). Credit alerts at 7 and 3 days before due, on the due date and when overdue; the before-due days are admin-configurable (`credit_alert_days`).
- The live D1 (`yarnflow-db`) has `0000`–`0003` applied and holds real users, suppliers, lots and stock movements; `0004_sales.sql` is not applied yet and will be applied together with `0005` when Task 1 deploys. Every migration from `0005` on must apply cleanly on top of `0004` against those rows. Allowed: `CREATE TABLE`, `ALTER TABLE … ADD COLUMN`, `CREATE INDEX/VIEW/TRIGGER`, `INSERT` of lookup rows, `UPDATE` of newly added columns (plus the one-time role mapping in `0005`). An owning additive migration may replace a guard trigger atomically (DROP TRIGGER followed by CREATE TRIGGER in that migration) when its accounting sources change; test that the replacement preserves the invariant. Never edit `0000`–`0004`. Never drop a table that may hold rows; superseded tables stay and stop being written. `tests/migrations.test.mjs` (Task 1) rehearses every migration file on live-shaped data; each task that adds a migration runs it.
- Each task is deployed to the live site after review by the controller (this plan adds no deploy steps). So every task leaves the deployed site usable: signed-in users keep working, and each superseded legacy mutation is disabled or delegates to the new guarded route in the same task as its backend invariant, with its current UI updated there. Final screen/route retirement is purchasing Task 19, sales/dispatch Task 20, quality/supervisor stock Task 21; the permission shim goes in Task 22. New workflows without a screen yet are reachable through the API only.
- Code style: dense ESM, reuse `server/erp-utils.mjs` (`json`, `fail`, `one`, `all`, `query`, `text`, `multiline`, `integer`, `recordId`, `keys`, `date`, `email`, `phone`, `website`), idempotent writes keyed by a client UUID `id` plus `request_hash` where the existing code does so, state guards must abort the entire transaction when a transition loses a race; a zero-row conditional UPDATE alone cannot guard later audit, notification or stock statements.
- UI follows `DESIGN.md` (Cone Code): sections on the sheet without cards, stone fields only for forms and records, one ink primary pill per view, status as tint + word + icon, threads for sequences, every new string bilingual through `t('English', 'اردو')`, 44 px touch targets. No lime, charcoal-on-lime or KPI-tile dashboards; no crowded screens (sub-screens go in a segmented control, not the sidebar).
- Out of scope, never plan or build: supplier or buyer portal screens, production planning, payroll or HR, manufacturing job tracking, free-form chat, payment gateways, any role beyond the six.
- Every test sketch in a task becomes executable setup, actions and assertions; no test may be empty.
- Each task ends green: `npm test` reports `fail 0` and `npx tsc -b` prints nothing. Tasks that touch `src/` also run `npx playwright test --project=desktop-chromium` and update the e2e specs whose screens they change, so it passes too. Nothing is pushed by this plan.
- Commit messages are plain sentences with no `Co-Authored-By` line and no AI attribution. The user is the sole author.

## Review Focus

- Two decisions on the same pending item at once (two admins, or an admin intervening while the supervisor decides): exactly one lands, the other gets 409 and no side effect runs twice. Pinned in Task 4.
- A threshold changed while items are pending: pending requests keep the threshold they were raised under, and the decision applies the stored payload, not a recomputed one. Pinned in Task 4.
- The tracking provider is down, slow, returns garbage or no key is configured: the page gets 200 with the last cached status and an error message, never a 500, and the key never leaks into the response. Pinned in Task 8.
- A user is deactivated or has their role changed while signed in on another device: the next request is refused or uses the new role. Pinned in Task 1.
- Invoices noted around midnight on 31 December in Karachi, or two sales noted at the same moment: numbers stay unique, sequential within the Karachi year, and restart at `0001`. Pinned in Task 12.

---

### Task 1: Six-role RBAC and migration of existing users

**Files:**
- Create: `drizzle/0005_roles.sql`
- Create: `server/admin.mjs`
- Create: `tests/portal-fixture.mjs`, `tests/rbac.test.mjs`, `tests/migrations.test.mjs`
- Modify: `server/auth.mjs` (roles, `userRow`, `seedRows`)
- Modify: `server/erp-utils.mjs` (add `reason`, `role`, `viewer`; `allow` becomes a role shim)
- Modify: `server/inventory.mjs:131-202,305-412` (router, `currentMember`, `authRoute`; delete `usersRoute`)
- Modify: `src/inventory-client.ts` (`Member`), `src/Team.tsx` (role picker, deactivate), `src/SignIn.tsx` (remove the account-request step), `src/LiveApp.tsx` (role name under the user; drop the never-live `sales` tab), `src/main.tsx` (drop the never-live `#/buyer` route)
- Modify: `tests/inventory-api.test.mjs`, `tests/procurement-api.test.mjs` (fixtures use roles)
- Modify: `e2e/every-button.spec.ts:69-125` (replace the join-request test), `e2e/inventory.spec.ts:60` (create the second person with a role)
- Modify: `tests/sales-api.test.mjs` (manager fixture and actor objects use `sales_manager`; keep its money/calendar and workflow assertions until Task 12).

**Interfaces:**
- Consumes: nothing new.
- Produces:
  - `server/auth.mjs`: `ROLES: string[]` (the six ids in spec order); `ROLE_PERMISSIONS: Record<role, string[]>` (transitional so the legacy screens keep working; deleted in Task 22); `userRow({ id?, workspaceId, name, pin, role = null, status = 'active', createdBy = null, now? }) → Promise<{ sql, args }>`.
  - `server/erp-utils.mjs`: `reason(value: unknown, label = 'Reason') → string`; `role(member, data, ...roles: string[]) → string | null` (returns the intervention reason, or null when the caller owns the action); `viewer(member, ...roles: string[]) → void`.
  - Signed-in member object everywhere: `{ user_id, workspace_id, name, role: <one of ROLES>, admin: boolean, permissions: string[] }` (`permissions` only until Task 22).
  - `src/inventory-client.ts`: `export type Role = 'admin' | 'purchase_manager' | 'quality_inspector' | 'supervisor' | 'sales_manager' | 'dispatch'`; `Member = { user_id, name, role: Role, admin: boolean, permissions: Permission[] }`; `roleLabel: Record<Role, [string, string]>` (English, Urdu, same names as the `roles` table).
  - `server/admin.mjs`: `adminApi(request, env, member, path, data) → Promise<Response>`; routes `GET /api/erp/admin/users`, `POST /api/erp/admin/users`, `POST /api/erp/admin/users/update`.
  - `server/inventory.mjs`: an `erp` map keyed by the third path segment of `/api/erp/<segment>/…` (`{ admin: adminApi }`); unmatched segments fall through to `staffProcurement`. Later tasks add entries.
  - `tests/portal-fixture.mjs`: `migrate(sql, names?: string[])`; `portalFixture() → Promise<{ sql, env, workspaceId, adminId, person(name, role) → Promise<string>, login(name, pin = '2468') → Promise<{ status, cookie }>, call(path, body?, as = 'Anas', headers = {}) → Promise<{ status, data, text, headers }>, member(name) → Promise<member> }>`. `env` is `{ DB, BUCKET }` with an in-memory `Map` bucket (`put/get/delete`). `call(..., null)` sends no cookie. Seeded admins: Anas, Fahad, Zuhair, PIN `2468`.
  - `tests/portal-fixture.mjs` also exports `liveShapedRows(sql) → void`, which seeds, after `0000`–`0003`, what the live D1 holds (one workspace; the three admins and, all with PIN `2468`, members named after the legacy presets they hold: `Stores ["receive","catalog"]`, `Quality ["inspect","qc"]`, `Dispatch ["dispatch"]`, `Purchase ["suppliers","procure"]`, `Everything` (all 13) and `ViewOnly` (`[]`); a pending user; sessions; two products, three lots, receive/transfer/dispatch movements with `stock_deltas`; quality events; an approved supplier with a supplier user, an RFQ, a bid, an accepted PO with `terms_snapshot`, a shipment notice and a goods receipt). Later tasks extend it when their migration touches a table it does not yet seed.

- [ ] **Step 1: Write the fixture and the failing tests**

`tests/portal-fixture.mjs` follows the fixture in `tests/inventory-api.test.mjs:13-56` (fresh `DatabaseSync(':memory:')`, `PRAGMA foreign_keys=ON`, all `drizzle/*.sql` in order, `seedRows('2468')`, requests through `inventoryApi` with `Origin: https://yarnflow.test`). `person(name, role)` inserts through `userRow` and returns the id.

`tests/migrations.test.mjs` (globs every migration, so each later task rehearses its own file automatically):

```js
test('every migration after 0003 applies on live-shaped data without losing a row', () => {
  const sql = new DatabaseSync(':memory:'); sql.exec('PRAGMA foreign_keys=ON');
  migrate(sql, ['0000_inventory.sql','0001_users.sql','0002_procurement.sql','0003_purchase_receipts.sql']);
  liveShapedRows(sql);
  const balancesBefore = sql.prepare('SELECT lot_id,stage,grams FROM balances ORDER BY lot_id,stage').all();
  const before = Object.fromEntries(['users','sessions','products','lots','movements','stock_deltas','balances','quality_events',
    'suppliers','supplier_users','procurement_rfqs','supplier_bids','supplier_purchase_orders','procurement_shipments','goods_receipts','erp_audit_events']
    .map(t => [t, sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n]));
  migrate(sql, readdirSync(dir).filter(f => f.endsWith('.sql') && f >= '0004').sort());
  for (const [t, n] of Object.entries(before)) assert.equal(sql.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n, n, t);
  assert.deepEqual(sql.prepare('PRAGMA foreign_key_check').all(), []);
  assert.equal(sql.prepare('PRAGMA integrity_check').get().integrity_check, 'ok');
  assert.deepEqual(sql.prepare('SELECT lot_id,stage,grams FROM balances ORDER BY lot_id,stage').all(), balancesBefore);
});
```

`tests/rbac.test.mjs`:

```js
test('existing users map to the closest of the six roles and keep signing in', async () => {
  // after 0000–0003 + liveShapedRows + 0004 + 0005:
  const expected = { Anas:'admin', Stores:'supervisor', Quality:'quality_inspector', Dispatch:'dispatch',
    Purchase:'purchase_manager', Everything:'supervisor', ViewOnly:'quality_inspector' };
  for (const [name, role] of Object.entries(expected)) assert.equal(sql.prepare('SELECT portal_role FROM users WHERE name=?').get(name).portal_role, role);
  // the pending user keeps status 'pending'; COUNT(sessions) unchanged; roles table ids in spec order
  // through inventoryApi on this database: login Stores (PIN from liveShapedRows) → 200; GET /workspace → member.role 'supervisor',
  // member.permissions includes 'receive' and 'catalog' (the legacy Stock screen still works)
});
test('admin creates users with exactly one of the six roles', async () => {
  // POST /erp/admin/users {name:'Pervaiz', pin:'1357', role:'purchase_manager'} → 201
  // role 'owner' → 422, role 'member' → 422, missing role → 422
  // as a supervisor → 403; GET list includes {name:'Pervaiz', role:'purchase_manager', status:'active'}
});
test('a deactivated user or one without a role cannot sign in; deactivation ends live sessions', async () => {
  // person('Saima','supervisor'); login → 200; admin update {id, active:false} → 200
  // GET /workspace with Saima's old cookie → 401
  // login Saima → 403 'This account is deactivated. Ask an admin.'
  // update {id, active:true} → login 200
  // a row with portal_role NULL (inserted directly) → login 403 'An admin must assign your role first.'
  // GET /auth/people lists neither the deactivated nor the role-less user
});
test('a role change applies on the very next request', async () => {
  // Saima (supervisor) GET /erp/admin/users → 403; admin sets role 'admin'; same cookie → 200
});
test('self sign-up is gone', async () => { /* POST /auth/signup {name:'New',pin:'1234'} → 404 */ });
test('admins cannot deactivate themselves or demote the last active admin', async () => {
  // Anas deactivates Anas → 409; demote Fahad and Zuhair → 200; demote Anas → 409 'Keep at least one admin.'
});
test('role(): owners pass, other roles get 403, admins need an intervention reason', () => {
  assert.equal(role({ role: 'supervisor' }, {}, 'supervisor'), null);
  assert.throws(() => role({ role: 'dispatch' }, {}, 'supervisor'), e => e.status === 403);
  assert.throws(() => role({ role: 'admin', admin: true }, {}, 'supervisor'), e => e.status === 422);
  assert.equal(role({ role: 'admin', admin: true }, { interventionReason: 'Supervisor is on leave today' }, 'supervisor'), 'Supervisor is on leave today');
  assert.equal(role({ role: 'admin', admin: true }, {}, 'admin'), null);
  assert.doesNotThrow(() => viewer({ role: 'admin', admin: true }, 'supervisor'));
  assert.throws(() => viewer({ role: 'dispatch' }, 'supervisor'), e => e.status === 403);
});
```

Fill the commented bodies with `f.call(...)` and `assert.equal(status, …)` exactly as stated.

Additional migration proof: `test('migrations preserve stable values, not only counts and balances')` snapshots every seeded pre-existing column in the tables above (including supplier, PO terms and audit detail), ordered by primary key, before migration and deep-compares afterward. Exclude only the explicitly allowed one-time user role mapping; added columns are checked separately. Seed actual audit and commercial rows, not empty tables.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `node --test tests/rbac.test.mjs tests/migrations.test.mjs`
Expected: FAIL (`0005_roles.sql` missing, `role` not exported).

Metadata contract for Tasks 1–14: each owning migration inventories its new and affected entities against spec §5 and adds any missing `status`, `created_by`, `created_at`, `updated_at`. Immutable/event entities use a fixed status and `updated_at = created_at`, with no-update/no-delete guards. Creator attribution is the authenticated staff id, external identity with actor type, or `system:reminders`/`system:credit_alerts` for scheduled events; never invent a staff id. Existing rows use additive defaults or nullable provenance explicitly labelled `legacy:unknown`, without rewriting old immutable rows. In `tests/migrations.test.mjs`, assert required metadata columns and non-null metadata on newly created entities; preserve legacy values. Task 1 covers roles/users (role lookup metadata: status=active, creator=system:seed, both timestamps set at migration); subsequent owning migrations cover their entities as itemized below.

- [ ] **Step 3: Write `drizzle/0005_roles.sql`**

`CREATE TABLE roles(id TEXT PRIMARY KEY, name TEXT NOT NULL, urdu_name TEXT NOT NULL, sort_order INTEGER NOT NULL)` with rows `admin/Admin/ایڈمن`, `purchase_manager/Purchase Manager/خریداری مینیجر`, `quality_inspector/Quality Inspector/کوالٹی انسپکٹر`, `supervisor/Supervisor/سپروائزر`, `sales_manager/Sales Manager/سیلز مینیجر`, `dispatch/Dispatch/ڈسپیچ` (sort 1–6). Then `ALTER TABLE users ADD COLUMN portal_role TEXT REFERENCES roles(id)`, `deactivated_at INTEGER`, `deactivated_by TEXT`, `updated_at INTEGER`, and the one-time mapping. The order follows the presets in `src/Team.tsx:28-33` and decides people with mixed permissions; view-and-scan-only members (`[]`) become quality inspectors because the scanner is an inspection tool:

```sql
UPDATE users SET updated_at = created_at, portal_role = CASE
 WHEN role = 'admin' THEN 'admin'
 WHEN json_array_length(permissions) >= 13 THEN 'supervisor'
 WHEN permissions LIKE '%"procure"%' OR permissions LIKE '%"suppliers"%' THEN 'purchase_manager'
 WHEN permissions LIKE '%"sales"%' OR permissions LIKE '%"payments"%' THEN 'sales_manager'
 WHEN permissions LIKE '%"inspect"%' THEN 'quality_inspector'
 WHEN permissions LIKE '%"receive"%' OR permissions LIKE '%"produce"%' OR permissions LIKE '%"catalog"%' OR permissions LIKE '%"waste"%'
   OR permissions LIKE '%"reverse"%' OR permissions LIKE '%"production"%' OR permissions LIKE '%"qc"%' THEN 'supervisor'
 WHEN permissions LIKE '%"dispatch"%' THEN 'dispatch'
 ELSE 'quality_inspector' END;
```

The legacy `role` and `permissions` columns stay; `userRow` keeps them consistent (`role` = `'admin'` when `portal_role='admin'`, else `'member'`; `permissions='[]'`).

- [ ] **Step 4: Implement the helpers and routes**

- `server/auth.mjs`: replace `PERMISSIONS` with `ROLES` and `ROLE_PERMISSIONS` = `{ admin: [all 13 legacy ids], purchase_manager: ['suppliers','procure','receive'], quality_inspector: ['inspect','qc'], supervisor: ['receive','produce','catalog','qc','waste','reverse','dispatch'], sales_manager: ['sales','payments'], dispatch: ['dispatch'] }` (each set covers what that role's users could do on the live screens before, so nobody loses a working screen before Tasks 18–21 replace it). `userRow` throws `Error('Unknown role')` for a role outside `ROLES` (null allowed). `seedRows` passes `role: 'admin'`.
- `server/erp-utils.mjs`: `reason = (value, label='Reason') => multiline(value, label, 5, 1000)`. `role()` returns null when `roles.includes(member.role)`; otherwise 403 `'Your role cannot do this. Ask an admin.'` unless `member.role === 'admin'`, in which case it returns `reason(data?.interventionReason, 'Intervention reason')`. `viewer()` passes admins and the listed roles, else the same 403. `allow(member, permission)` keeps its signature and reads `member.permissions` (role-derived).
- `server/inventory.mjs` `currentMember`: also require `u.deactivated_at IS NULL AND u.portal_role IS NOT NULL`; return `role: user.portal_role`, `admin: user.portal_role === 'admin'`, `permissions: ROLE_PERMISSIONS[user.portal_role]`. Login: after the PIN check, refuse `deactivated_at` (403 `'This account is deactivated. Ask an admin.'`) and null role (403 `'An admin must assign your role first.'`). Delete the `/api/auth/signup` branch and `usersRoute`; `/api/auth/people` filters `deactivated_at IS NULL AND portal_role IS NOT NULL`. Mount `const erp = { admin: adminApi }` before the `staffProcurement` fallback; delete the `/api/users` branch.
- `server/admin.mjs` `adminApi`: every route `role(member, data, 'admin')` / `viewer(member)` (admin only). `GET users` → `{ users: [{ id, name, role, status: 'active'|'pending'|'deactivated', created_at, locked }] }`. `POST users {name, pin, role}` (role in `ROLES`). `POST users/update {id, role?, pin?, active?}`: `active:false` sets `deactivated_at/by` and deletes the user's sessions; `active:true` clears them and sets `status='active'` (this also activates legacy pending accounts); a PIN reset deletes the user's sessions; a role change keeps sessions and applies on the next request. Keep the last-admin guard (`409 'Keep at least one admin.'`) and refuse self-deactivation (409). Audit each change with the existing `audit()`: `user.created`, `user.role_changed`, `user.deactivated`, `user.reactivated`, `user.pin_reset`.
- `src/Team.tsx`: keep its layout; replace `PermissionPicker`, `AdminSwitch` and the presets with one `<select>` labelled `t('Role', 'کردار')` listing the six `roleLabel` entries; calls move to `/erp/admin/users*`; the remove button becomes `t('Deactivate', 'غیر فعال کریں')` / `t('Reactivate', 'دوبارہ فعال کریں')`; a waiting (legacy pending) person is approved by choosing a role. `accessSummary(role, language)` returns the role label.
- `src/SignIn.tsx`: delete the `request`/`sent` steps and the "New here? Ask for an account" button. `src/LiveApp.tsx`: `whoAmI` shows `roleLabel[me.role]`; the Settings access list uses `accessSummary`; remove `'sales'` from `tabs` (that screen was never live because `0004` was unapplied; Task 20 replaces it). `src/main.tsx`: remove the `#/buyer` branch (never live; its component is deleted with sales-client in Task 20).

- [ ] **Step 5: Move the legacy tests to roles**

- `tests/inventory-api.test.mjs`: `addPerson(name, role)` posts `/erp/admin/users {name, pin, role}`. Delete `'requires a signed-in person and the right permission for each kind of entry'`, `'a requested account waits for an admin, who approves it with permissions'` and `'admins add, promote, reset and remove people, but never the last admin or themselves'` (rbac.test.mjs covers them). In the QC test use `addPerson('Store', 'dispatch')`, make the first receive as `'Anas'`, keep the other assertions. In the isolation test read `/erp/admin/users` for `Outsider`.
- `tests/procurement-api.test.mjs`: line 59 `role: 'purchase_manager'`, line 170 `role: 'supervisor'`.
- `e2e/inventory.spec.ts:60`: `apiPost(page, '/erp/admin/users', { name: 'Nadia', pin: '1357', role: 'supervisor' })`.
- `e2e/every-button.spec.ts`: replace the join-request test with `"an admin adds a supervisor; both see the same stock; deactivation signs them out"`: on Team, Add a person (Name `Bilal`, PIN `1357` twice, Role `Supervisor`), Bilal signs in on a second context and sees the same Stock rows, the admin presses Deactivate, Bilal's next refresh lands on the sign-in screen.

- `tests/sales-api.test.mjs`: replace the old permissions-only manager fixture with `userRow({…, role: 'sales_manager'})` and give its actor objects the matching role-derived member contract. Preserve its assertions until Task 12 ports them.

- [ ] **Step 6: Run all tests, the type check and e2e**

Run: `npm test && npx tsc -b && npx playwright test --project=desktop-chromium`
Expected: `fail 0`; tsc prints nothing; Playwright `passed`, none failed.

- [ ] **Step 7: Commit**

```bash
git add drizzle/0005_roles.sql server/auth.mjs server/erp-utils.mjs server/admin.mjs server/inventory.mjs src/inventory-client.ts src/Team.tsx src/SignIn.tsx src/LiveApp.tsx src/main.tsx tests/portal-fixture.mjs tests/rbac.test.mjs tests/migrations.test.mjs tests/inventory-api.test.mjs tests/procurement-api.test.mjs e2e/every-button.spec.ts e2e/inventory.spec.ts tests/sales-api.test.mjs
git commit -m "Replace admin/member permissions with the six factory roles and map existing users to them"
```

### Task 2: Append-only audit log with reasons, roles and old/new values

**Files:**
- Create: `drizzle/0006_audit.sql`
- Create: `tests/audit.test.mjs`
- Modify: `server/erp-utils.mjs` (`audit`)
- Modify: `server/admin.mjs` (audit routes; role-change audit gains before/after)
- Modify: `server/procurement.mjs:44-57` (supplier review audit carries `reason`), `server/sales.mjs:194-213` (buyer review audit carries `reason`)
- Modify: `server/procurement.mjs:107` (repair the conditional raw bid-rejection audit INSERT immediately after adding audit columns).

**Interfaces:**
- Consumes: Task 1 member object, `adminApi`, `portalFixture`.
- Produces:
  - `audit(db, member, action, id, detail = {}, type = 'staff', { objectType = action.split('.')[0], before = null, after = null, reason = null, intervention = null } = {}) → Statement`. Existing five/six-argument calls keep working. `actor_role` = `member.role ?? type`.
  - Action naming rule used by every later task: `<object>.<verb>`; verbs `rejected`, `dismissed`, `held`, `suspended`, `cancelled`, `adjusted`, `overridden` require a reason at the database.
  - `GET /api/erp/admin/audit?actor=&action=&objectType=&objectId=&from=&to=&interventions=1&before=<created_at>:<id>` → `{ events: [{ id, actor_id, actor_name, actor_role, action, object_type, record_id, old_json, new_json, reason, intervention_reason, detail_json, created_at }], next: string | null }` (100 per page, newest first). Admin only.

- [ ] **Step 1: Write the failing tests** (`tests/audit.test.mjs`)

```js
test('audit rows cannot be updated or deleted', async () => {
  // write one row through audit(); then
  assert.throws(() => f.sql.exec("UPDATE erp_audit_events SET action='x'"), /immutable audit/);
  assert.throws(() => f.sql.exec('DELETE FROM erp_audit_events'), /immutable audit/);
});
test('rejections, dismissals, holds and interventions without a reason are refused by the database', async () => {
  const m = await f.member('Anas');
  await assert.rejects(f.env.DB.batch([audit(f.env.DB, m, 'bid.rejected', id, {})]), /reason required/);
  await f.env.DB.batch([audit(f.env.DB, m, 'bid.rejected', id, {}, 'staff', { reason: 'Price above budget' })]);
  await assert.rejects(f.env.DB.batch([audit(f.env.DB, m, 'lot.arrived', id, {}, 'staff', { intervention: ' ' })]), /reason required/);
});
test('each row records user, role, action, object type and id, old and new values, reason and time', async () => {
  // admin changes Saima from 'dispatch' to 'supervisor' via /erp/admin/users/update
  // row: actor_id = adminId, actor_role 'admin', action 'user.role_changed', object_type 'user', record_id = Saima's id,
  // JSON.parse(old_json) deepEqual {role:'dispatch'}, JSON.parse(new_json) deepEqual {role:'supervisor'}, typeof created_at 'number'
});
test('admin reads the whole log with filters and pages; other roles cannot', async () => {
  // 105 audit rows → page 1 has 100 and next !== null; page 2 has 5 and next === null
  // ?objectType=user returns only object_type 'user'; supervisor GET → 403
});
test('audit rows written before this migration survive it', async () => {
  // migrate 0000–0005, insert a legacy row, migrate 0006; row is present with actor_role '' and object_type ''
});
```

Add `test('legacy bid rejection survives migration 0006 and audits once')`: seed a submitted bid, reject with `Price above budget` → 200 and exactly one audit row with `reason='Price above budget'`; repeat/stale version → 409 with unchanged bid history and audit count.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/audit.test.mjs`
Expected: FAIL (`no such column: actor_role`).

- [ ] **Step 3: Write `drizzle/0006_audit.sql`**

`ALTER TABLE erp_audit_events ADD COLUMN` `actor_role TEXT NOT NULL DEFAULT ''`, `object_type TEXT NOT NULL DEFAULT ''`, `old_json TEXT`, `new_json TEXT`, `reason TEXT`, `intervention_reason TEXT`. `CREATE INDEX erp_audit_time ON erp_audit_events(workspace_id, created_at DESC, id DESC)`. Trigger:

```sql
CREATE TRIGGER erp_audit_reason_required BEFORE INSERT ON erp_audit_events BEGIN
 SELECT RAISE(ABORT,'reason required') WHERE (NEW.action GLOB '*.rejected' OR NEW.action GLOB '*.dismissed' OR NEW.action GLOB '*.held'
   OR NEW.action GLOB '*.suspended' OR NEW.action GLOB '*.cancelled' OR NEW.action GLOB '*.adjusted' OR NEW.action GLOB '*.overridden')
   AND length(trim(COALESCE(NEW.reason,''))) < 5;
 SELECT RAISE(ABORT,'reason required') WHERE NEW.intervention_reason IS NOT NULL AND length(trim(NEW.intervention_reason)) < 5;
END;
```

The existing `erp_audit_no_update`/`erp_audit_no_delete` triggers stay as the append-only guarantee.

- [ ] **Step 4: Implement `audit()` and the routes**

Extend the INSERT column list in `server/erp-utils.mjs`; serialise `before`/`after` with `JSON.stringify` (null stays NULL). In `adminApi` add the `GET /api/erp/admin/audit` route (keyset paging on `(created_at, id)`, joins `users` for `actor_name`); pass `{ before: { role: old }, after: { role: new } }` on `user.role_changed`. In `procurement.mjs` supplier review and `sales.mjs` buyer review pass `{ reason, before: { status: old }, after: { status: new } }` so their `*.rejected`/`*.suspended` rows satisfy the trigger.

Replace the bid-rejection `INSERT INTO erp_audit_events SELECT …` here with an explicit column list including `actor_role`, `object_type`, `reason`, `intervention_reason`. Preserve its original conditional predicate and ensure the losing bid transition emits no audit. Reason-bearing helper calls always use `audit(db,member,action,id,detail,'staff',{reason,intervention,before,after})`, never put options in `detail`. Migration 0006 also supplies fixed event status, creator attribution and updated timestamp metadata for new audit rows using additive columns/defaults; audit() and the conditional INSERT both populate created_by=actor_id, status=recorded and updated_at=created_at.

- [ ] **Step 5: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0006_audit.sql server/erp-utils.mjs server/admin.mjs server/procurement.mjs server/sales.mjs tests/audit.test.mjs
git commit -m "Record role, object, old and new values and reasons in the append-only audit log"
```

### Task 3: Admin thresholds with change history, and admin settings

**Files:**
- Create: `drizzle/0007_thresholds_settings.sql`
- Create: `server/governance.mjs`
- Create: `tests/thresholds.test.mjs`
- Modify: `server/admin.mjs` (threshold and settings routes)

**Interfaces:**
- Consumes: `role`, `viewer`, `audit` (Tasks 1–2).
- Produces (`server/governance.mjs`):
  - `THRESHOLDS = ['purchase','inventory_adjustment','claim','dispatch_stock_issue']`. Units: `purchase` and `claim` in money minor units; `inventory_adjustment` and `dispatch_stock_issue` in grams.
  - `DEFAULT_SETTINGS = { currency: 'PKR', tax_rate_bp: 1800, invoice_format: 'INV-{YYYY}-{NNNN}', reminder_hours: 24, credit_alert_days: [7, 3] }`.
  - `thresholdOf(db, workspaceId, type) → Promise<number | null>` (null when the admin never set it).
  - `settingsOf(db, workspaceId) → Promise<typeof DEFAULT_SETTINGS>`.
  - Routes in `adminApi`: `GET /api/erp/admin/thresholds` → `{ thresholds: [{ type, value, currency, updated_by_name, updated_at }], history: [{ type, old_value, new_value, old_currency, new_currency, changed_by_name, changed_at }] }`; `POST /api/erp/admin/thresholds {type, value}`; `GET /api/erp/admin/settings` → `{ settings }`; `POST /api/erp/admin/settings {key, value}`. All admin only.

- [ ] **Step 1: Write the failing tests** (`tests/thresholds.test.mjs`)

```js
test('only admin sets each of the four thresholds; history records who, old, new and when', async () => {
  // POST {type:'purchase', value:50000000} → 200; then {value:75000000} → 200
  // history for 'purchase' oldest first: [{old_value:null,new_value:50000000,changed_by:adminId}, {old_value:50000000,new_value:75000000,changed_by:adminId}], changed_at numbers
  // audit row 'threshold.changed': old_json {"value":50000000}, new_json {"value":75000000}
  // supervisor POST → 403; type 'payroll' → 422; value -1 → 422; value 1.5 → 422
});
test('threshold history cannot be edited or deleted', async () => {
  assert.throws(() => f.sql.exec('UPDATE threshold_history SET new_value=1'), /immutable threshold history/);
  assert.throws(() => f.sql.exec('DELETE FROM threshold_history'), /immutable threshold history/);
});
test('an unset threshold is not configured, so decisions stay final as before', async () => {
  assert.equal(await thresholdOf(f.env.DB, f.workspaceId, 'claim'), null);
});
test('settings default to PKR, 18% GST, INV-YYYY-NNNN, 24 h and 7/3-day alerts; only admin edits them', async () => {
  assert.deepEqual(await settingsOf(f.env.DB, f.workspaceId), { currency:'PKR', tax_rate_bp:1800, invoice_format:'INV-{YYYY}-{NNNN}', reminder_hours:24, credit_alert_days:[7,3] });
  // invoice_format 'INV-{NNNN}' → 422; 'FAZ-{YYYY}-{NNNN}' → 200; tax_rate_bp 10001 → 422; reminder_hours 0 → 422;
  // credit_alert_days [7,3,1] → 200 and stored sorted descending; currency 'BTC' → 422; supervisor → 403; audit 'setting.changed' before/after
});
```

For `threshold history cannot be edited or deleted`, first set purchase=100 through the API, assert one history row, snapshot it, attempt each mutation and assert both the exception and unchanged contents. Add `test('currency changes refuse incompatible active commercial records')`: independently seed an open submitted bid, an unaccepted draft/sent quotation and an unpaid invoice; each currency change PKR→USD returns 409 with settings/history unchanged. With all three closed/accepted/paid, change succeeds; equal-currency saves are harmless. Race a new bid/quotation with the currency change: only compatible state may commit.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/thresholds.test.mjs`
Expected: FAIL (module `server/governance.mjs` not found).

- [ ] **Step 3: Write `drizzle/0007_thresholds_settings.sql`**

- `thresholds(workspace_id REFERENCES workspaces, type CHECK IN the four, value INTEGER NOT NULL CHECK(value >= 0), status TEXT NOT NULL DEFAULT 'active' CHECK(status='active'), created_by, created_at, updated_by, updated_at, PRIMARY KEY(workspace_id,type))`.
- `threshold_history(id TEXT PRIMARY KEY, workspace_id, type, old_value INTEGER, new_value INTEGER NOT NULL, changed_by TEXT NOT NULL, changed_at INTEGER NOT NULL)` with no-update/no-delete triggers raising `'immutable threshold history'`.
- `AFTER INSERT` and `AFTER UPDATE OF value` triggers on `thresholds` that insert the history row (`lower(hex(randomblob(16)))` id, `OLD.value` or NULL, `NEW.value`, `NEW.updated_by`, `NEW.updated_at`). The database, not the route, guarantees every change is logged.
- `settings(workspace_id, key CHECK IN ('currency','tax_rate_bp','invoice_format','reminder_hours','credit_alert_days'), value_json TEXT NOT NULL, created_by, created_at, updated_by, updated_at, PRIMARY KEY(workspace_id,key))`.

- [ ] **Step 4: Implement `governance.mjs` and the admin routes**

Threshold writes are one `INSERT … ON CONFLICT(workspace_id,type) DO UPDATE` plus the audit row in one batch. Settings validation: `currency` ∈ `PKR,USD,EUR,GBP` (the CHECK lists in `0002`/`0004` allow only these); `tax_rate_bp` integer 0–10000; `invoice_format` 6–40 chars of `[A-Za-z0-9/-]` plus exactly one `{YYYY}` and one `{NNNN}`; `reminder_hours` integer 1–720; `credit_alert_days` 1–5 distinct integers 1–90, stored sorted descending.

Currency policy: `POST settings {key:'currency',value}` atomically refuses a different currency with 409 `'Close open bids and unaccepted quotations and settle unpaid invoices before changing currency.'` Open bids include submitted bids on uncancelled open/closed unawarded RFQs or pending awards; unaccepted quotations are draft/sent revisions; unpaid means invoice total minus credits and recorded payments > 0. In Task 3 use existing 0002/0004 tables, then Tasks 12–13 extend the same database guards for acceptances/credit notes/invoice payments. Guards on currency writes and commercial inserts make the check transactional. Add `currency` to monetary threshold/history rows and API projections (null for gram thresholds). A successful currency change leaves existing monetary threshold values/history in their recorded currency; they are not configured for a different current currency. An admin setting a new-currency threshold replaces the row's value/currency and appends history with old/new currency as well as old/new value, never relabels historical amounts. `thresholdOf` reads only configured-currency rows; gram thresholds are unchanged. Migration 0007 adds metadata to settings/history, including fixed `recorded` history status, creator and both timestamps.

- [ ] **Step 5: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0007_thresholds_settings.sql server/governance.mjs server/admin.mjs tests/thresholds.test.mjs
git commit -m "Add the four admin thresholds with database-kept change history, and invoice and reminder settings"
```

### Task 4: Generic approval-requests engine

**Files:**
- Create: `drizzle/0008_approvals.sql`
- Create: `tests/approvals.test.mjs`
- Modify: `server/governance.mjs`
- Modify: `server/inventory.mjs` (mount `approvals`, merged handler map)

**Interfaces:**
- Consumes: `thresholdOf`, `audit`, `role`, `viewer`.
- Produces:
  - Approval types: `'purchase_award' | 'po_change' | 'inventory_adjustment' | 'claim' | 'dispatch_stock_issue' | 'escalation'`; units `'minor' | 'grams' | 'none'`.
  - `needsApproval(db, workspaceId, thresholdType, amount) → Promise<{ required: boolean, threshold: number | null }>` (`required = threshold !== null && amount >= threshold`).
  - `approvalQueries(db, member, { id = crypto.randomUUID(), type, objectType, objectId, amount, threshold, unit, payload = {} }, now) → Statement[]` (Task 5 appends the admin notification to this array).
  - Handler contract each domain exports as `approvalHandlers`: `{ [type]: { approve(db, member, request, { now }) → Promise<Statement[]>, reject(db, member, request, { reason, now }) → Promise<Statement[]>, describe(db, request) → Promise<{ objectType, objectId, label, currency: string | null, evidence: object, proposed: object }> } }`. `request` is the `approval_requests` row with `payload` parsed.
  - `approvalsApi(request, env, member, path, data, handlers)`: `GET /api/erp/approvals?status=pending&type=` → `{ approvals }`; `GET /api/erp/approvals/<id>` → `{ approval, object }`; `POST /api/erp/approvals/decide {id, decision: 'approve'|'reject', reason?}` → `{ approval }`. Admin only.
  - `server/inventory.mjs`: `const approvalHandlers = {}` merged from domain modules (Tasks 7, 10, 11, 14 add spreads) and `erp.approvals = (rq, env, m, p, d) => approvalsApi(rq, env, m, p, d, approvalHandlers)`.

- [ ] **Step 1: Write the failing tests** (`tests/approvals.test.mjs`)

The tests call `approvalsApi(new Request(url, init), f.env, await f.member(name), path, body, handlers)` directly, converting a thrown `ErpProblem` into `{ status }` as `tests/sales-api.test.mjs:23-26` does, with a test-only handler map: `sql.exec('CREATE TABLE marker(v TEXT)')` and `handlers = { escalation: { approve: async db => [query(db, "INSERT INTO marker VALUES('approved')")], reject: async () => [], describe: async () => ({ objectType: 'qc_inspection', objectId: id, label: 'Test escalation', currency: null, evidence: {}, proposed: {} }) } }`. Nothing extra is exported for tests.

```js
test('at or above the threshold waits for admin; below is final', async () => {
  // set threshold claim=100 directly in SQL
  assert.deepEqual(await needsApproval(db, w, 'claim', 99), { required: false, threshold: 100 });
  assert.equal((await needsApproval(db, w, 'claim', 100)).required, true);
  assert.equal((await needsApproval(db, w, 'claim', 101)).required, true);
  assert.deepEqual(await needsApproval(db, w, 'purchase', 10 ** 12), { required: false, threshold: null }, 'unset: not gated');
});
test('admin approves once; the effect, the decision and the audit row land together', async () => {
  // batch approvalQueries(type 'escalation', objectType 'qc_inspection', amount 0, unit 'none'); decide approve → 200
  // marker has 1 row; status 'approved'; decided_by adminId; audit 'approval.approved' with old_json {"status":"pending"}
  // decide again → 409 'This request was already decided. Reload.'; marker still 1 row
});
test('a rejection needs a reason and has no effect', async () => {
  // decide reject without reason → 422; with 'Over budget this quarter' → 200; marker 0 rows; reason stored; audit 'approval.rejected'
});
test('only admins list or decide approvals', async () => { /* supervisor GET → 403, POST decide → 403 */ });
test('a failing effect rolls the decision back', async () => {
  // handler approve returns a statement that violates a CHECK; decide → 409 'The item changed since this request was raised. Reload and review it again.'; status still 'pending'
});
test('two admins deciding at once: exactly one decision lands', async () => {
  const [a, b] = await Promise.all([decide('Anas'), decide('Fahad')]);
  assert.deepEqual([a.status, b.status].sort(), [200, 409]);
  // marker has exactly 1 row
});
test('a later threshold change does not re-judge a pending request', async () => {
  // request raised with threshold 100 and amount 150; admin raises threshold to 1000; row.threshold still 100; approve still applies payload
});
test('one pending request per object', async () => { /* a second approvalQueries for the same objectType+objectId while pending → batch rejects */ });
```

Add `test('approval details include immutable request terms and complete domain evidence')`: GET each installed handler detail → 200 with the required shape; other workspace id → 404; non-admin → 403. Test-only handler supplies `describe` too. Add `test('admin cannot rewrite a decided request')`: second decision → 409 with original audit/payload unchanged; a test-handler compensating request with payload.compensatesId has a new id and its own reason/audit; production compensation routes are specified by their domain tasks.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/approvals.test.mjs`
Expected: FAIL (`needsApproval` not exported).

- [ ] **Step 3: Write `drizzle/0008_approvals.sql`**

`approval_requests(id PK, workspace_id, type CHECK IN the six, object_type TEXT NOT NULL, object_id TEXT NOT NULL, amount INTEGER NOT NULL DEFAULT 0, threshold INTEGER, unit TEXT NOT NULL CHECK(unit IN ('minor','grams','none')), payload_json TEXT NOT NULL DEFAULT '{}', status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')), requested_by TEXT NOT NULL, requested_role TEXT NOT NULL, decided_by TEXT, reason TEXT, created_at, updated_at, decided_at)`; `CREATE UNIQUE INDEX approval_one_pending ON approval_requests(object_type, object_id) WHERE status='pending'`; triggers: `approval_decided_once` (BEFORE UPDATE, `OLD.status != 'pending'` → `'approval already decided'`), `approval_terms_immutable` (type, object, amount, threshold, payload, requester), `approval_reject_reason` (`NEW.status='rejected'` and reason shorter than 5 → `'reason required'`), no-delete trigger.

Every one of the six handlers must implement `describe`: purchase award = pinned bid/version, supplier, RFQ and terms; PO change = old/new quantity and totals plus arrived quantity; adjustment = lot/stage/balance/delta/reason; claim = inspection/photos/rejected quantity/rate/amount; escalation = inspection/issues/photos/proposed disposition; stock issue = difference, optional correction, reason and both stored gates. Task 4 validates the common shape; owning domain tasks supply their evidence. Currency is the request-time currency, also stored immutably on monetary approval requests. Migration 0008 adds `created_by=requested_by`. Admin detail remains scoped to its workspace; missing handlers/detail produce 409, never an incomplete approval form.

- [ ] **Step 4: Implement the engine**

`decide`: load the row (404 if absent or other workspace); reject requires `reason()`; batch `[UPDATE approval_requests SET status=?, decided_by=?, decided_at=?, updated_at=?, reason=? WHERE id=?, ...await handlers[type][decision](...), audit(db, member, 'approval.approved'|'approval.rejected', id, { type }, 'staff', { objectType: 'approval', before: { status: 'pending' }, after: { status }, reason })]`. Map an error containing `approval already decided` to 409 `'This request was already decided. Reload.'`; any other batch error to 409 `'The item changed since this request was raised. Reload and review it again.'`. A missing handler is 500-safe: 409 with the same message.

- [ ] **Step 5: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0008_approvals.sql server/governance.mjs server/inventory.mjs tests/approvals.test.mjs
git commit -m "Add the generic approval-request engine with decide-once and reason-on-rejection guarantees"
```

### Task 5: Notifications and 24-hour reminders

**Files:**
- Create: `drizzle/0009_notifications.sql`
- Create: `server/notify.mjs`
- Create: `tests/notifications.test.mjs`
- Modify: `server/governance.mjs` (`approvalQueries` notifies admins; decide notifies the requesting role)
- Modify: `server/inventory.mjs` (mount `notifications`)
- Modify: `server/cloudflare.mjs` (`scheduled` runs `remindersScheduled`)
- Modify: `wrangler.jsonc` (`"crons": ["0 * * * *"]`)

**Interfaces:**
- Consumes: `settingsOf` (Task 3), approvals (Task 4).
- Produces (`server/notify.mjs`):
  - `EVENTS`: `'supplier.pending','buyer.pending','buyer_rfq.received','bid.received','bidding.closed','award.pending_approval','lot.ready','inspection.submitted','inspection.decided','approval.pending','approval.decided','claim.created','claim.decided','stock_query.created','stock_issue.raised','payment.due_soon','payment.due_today','payment.overdue','dispatch.approval_requested','dispatch.approved','dispatch.held','dispatch.hold_notice','reminder'`.
  - `notifyRole(db, workspaceId, role, event, objectType, objectId, label = '') → Statement` (one row per active, non-deactivated user holding the role).
  - `notifyUser(db, workspaceId, userId, event, objectType, objectId, label = '') → Statement`.
  - `notificationsApi(request, env, member, path, data)`: `GET /api/erp/notifications` → `{ notifications: [{ id, event, object_type, object_id, label, status, created_at }], unread }` (own rows, newest 100); `POST /api/erp/notifications/read {ids?: string[], all?: true}` → `{ read: number }`. Any signed-in role.
  - `PENDING_SOURCES: { objectType, role, sql }[]`; each `sql` selects `id, workspace_id, label, since` for items still awaiting a decision with `since <= ?` (the cutoff). Later tasks append entries.
  - `remindersScheduled(env, now = Date.now()) → Promise<{ checked: number, created: number }>`.
  - `approvalQueries` event is `'award.pending_approval'` for `purchase_award`, else `'approval.pending'`.

- [ ] **Step 1: Write the failing tests** (`tests/notifications.test.mjs`)

```js
test('each user sees only their own notifications', async () => {
  // two supervisors (one deactivated) and one inspector; batch notifyRole(…, 'supervisor', 'stock_issue.raised', 'stock_issue', id, 'Lot 1024')
  // active supervisor GET → unread 1, event 'stock_issue.raised'; deactivated supervisor has 0 rows; inspector GET → unread 0
  // inspector POST read {ids:[supervisor's id]} → {read:0}; supervisor POST read {all:true} → {read:1}; unread 0
});
test('a pending approval notifies every admin; the decision notifies the requesting role', async () => {
  // approvalQueries raised by a supervisor → 3 admin rows 'approval.pending'; decide → supervisor gets 'approval.decided'
});
test('pending items older than 24 hours remind the responsible role once', async () => {
  // approval row with created_at = now - 25*3600_000 → remindersScheduled(env, now) → {created: 3}
  // run again → {created: 0}; an item at now - 23 h → no reminder; reminder_hours 48 → none for the 25 h item
});
test('decided items never remind', async () => { /* approved row aged 30 h → created 0 */ });
```

Add `test('concurrent reminder runs deduplicate per recipient and pending episode')`: two simultaneous runs on one 25-hour-old approval create exactly three reminders total, one per admin; a repeat creates zero. Return a QC lot and re-pend the same id with a newer `since`, advance 25 hours and assert one additional reminder per inspector; the earlier rows remain. Assert the unique index rejects duplicate `(object_type,object_id,since,user_id)` inserts.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/notifications.test.mjs`
Expected: FAIL (`server/notify.mjs` not found).

- [ ] **Step 3: Write `drizzle/0009_notifications.sql`**

`notifications(id PK, workspace_id, user_id TEXT NOT NULL REFERENCES users(id), role TEXT NOT NULL, event TEXT NOT NULL, object_type TEXT NOT NULL, object_id TEXT NOT NULL, label TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'unread' CHECK(status IN ('unread','read')), created_by TEXT, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, read_at INTEGER, since INTEGER)`; indexes `(user_id, status, created_at DESC)` and `(object_type, object_id, event)`.

- [ ] **Step 4: Implement `notify.mjs`, wire approvals and the cron**

`notifyRole` inserts from users filtered by workspace, portal_role, active status and deactivated_at IS NULL, using an explicit column list including `since=NULL`; ordinary generated notices use `created_by='system:notifications'` and both timestamps. `notifyUser` uses the same shape. Reminders use explicit INSERT column lists, `event='reminder'`, `created_by='system:reminders'` and the pending source's `since`. Add unique partial index `notification_reminder_episode ON notifications(object_type,object_id,since,user_id) WHERE event='reminder'`; `since` is required for reminders. Use targeted `ON CONFLICT … DO NOTHING` against that key, rechecking the source is still pending in the insert transaction; count inserted rows, not candidates. Use each workspace's `reminder_hours`. Ordinary notifications have `since=NULL`. A source changes `since` only when a new pending episode starts, not on unrelated edits. First `PENDING_SOURCES` entry: `{ objectType: 'approval', role: 'admin', sql: "SELECT id, workspace_id, type AS label, created_at AS since FROM approval_requests WHERE status='pending' AND created_at <= ?" }`. `cloudflare.mjs` `scheduled`: `ctx.waitUntil(Promise.all([salesScheduled(env), remindersScheduled(env)]))` (Task 12 swaps `salesScheduled` out).

- [ ] **Step 5: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0009_notifications.sql server/notify.mjs server/governance.mjs server/inventory.mjs server/cloudflare.mjs wrangler.jsonc tests/notifications.test.mjs
git commit -m "Add the shared notification inbox and hourly reminders for items pending over 24 hours"
```

### Task 6: Suppliers: purchase-manager approval, statuses, categories, ratings and profile

**Files:**
- Create: `drizzle/0010_suppliers.sql`
- Create: `tests/suppliers.test.mjs`
- Modify: `server/procurement.mjs:1-58` (supplier routes)
- Modify: `server/notify.mjs` (`PENDING_SOURCES`)
- Modify: `tests/portal-fixture.mjs` (supplier helper), `tests/procurement-api.test.mjs` (fixture approves as a purchase manager)
- Modify: `src/Procurement.tsx` (keep the live supplier review working: show `SupplierReview` to `member.role === 'purchase_manager' || member.admin`, add an `Intervention reason` field when `member.admin`, send `interventionReason`; remove the `Add supplier contact` button and `SupplierContactForm`), `e2e/procurement.spec.ts` (the admin fills the intervention reason `Purchase manager not set up yet` when approving)

**Interfaces:**
- Consumes: `role`, `viewer`, `reason`, `audit` with `{ reason, before, after, intervention }`.
- Produces:
  - `GET /api/erp/suppliers?status=&category=` → `{ suppliers }` (only statuses `pending, approved, rejected, suspended`); viewer `purchase_manager`.
  - `GET /api/erp/suppliers/<id>` → `{ supplier, ratings: [{ rating, feedback, created_by_name, created_at }], performance }`.
  - `POST /api/erp/suppliers/review {id, status: 'approved'|'rejected'|'suspended', reason?, version, categories?, interventionReason?}`; role `purchase_manager`.
  - `POST /api/erp/suppliers/profile {id, version, contactName?, phone?, city?, website?, categories?, interventionReason?}`; role `purchase_manager`; audit `supplier.profile_updated` with before/after.
  - `POST /api/erp/suppliers/rate {id, supplierId, rating, feedback?, interventionReason?}`; role `purchase_manager`; audit `supplier.rated`.
  - `supplierPerformance(db, supplierId) → Promise<{ manualAverage: number | null, ratingCount: number }>` (Task 10 extends the return type).
  - `categoryIds()` accepts up to 9 ids.
  - Fixture: `insertSupplier({ name, status = 'pending', categories = ['cotton'] }) → Promise<string>`.

- [ ] **Step 1: Write the failing tests** (`tests/suppliers.test.mjs`)

```js
test('the purchase manager approves or rejects pending suppliers; rejection needs a reason', async () => {
  // Pervaiz = person('Pervaiz','purchase_manager'); s = insertSupplier({})
  // review {id:s,status:'rejected',version:1} → 422; with reason 'Could not verify the NTN' → 200, status 'rejected'
  // audit 'supplier.rejected' reason stored, old_json {"status":"pending"}
});
test('nobody adds suppliers from the factory side', async () => { /* POST /erp/suppliers {...} → 404 */ });
test('statuses move only pending→approved|rejected and approved↔suspended', async () => {
  // rejected → approved 409; approved → suspended without reason 422, with reason 200; suspended → approved 200; pending → suspended 409
});
test('the list filters by status and category and hides directory contacts', async () => {
  // directory row inserted with status 'directory' is absent; ?status=pending&category=dyes returns only the dyes supplier
});
test('other roles cannot review; an admin needs an intervention reason', async () => {
  // quality_inspector → 403; admin without interventionReason → 422; with 'Purchase manager away this week' → 200, audit intervention_reason stored
});
test('ratings are 1 to 5, kept as history and averaged on the profile', async () => {
  // rate 4 and 5 → profile.performance {manualAverage: 4.5, ratingCount: 2}; rating 6 → 422; rating 0 → 422
});
test('categories include dyes, chemicals and packaging', async () => {
  // GET /erp/categories → 9 rows; last three ids ['dyes','chemicals','packaging']
});
test('a supplier pending over 24 hours reminds purchase managers', async () => { /* created_at now-25h → remindersScheduled → Pervaiz has 'reminder' */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/suppliers.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Write `drizzle/0010_suppliers.sql`**

`INSERT INTO supplier_categories(id,name,urdu_name,sort_order) VALUES ('dyes','Dyes','رنگ',7),('chemicals','Chemicals','کیمیکل',8),('packaging','Packaging','پیکنگ',9)`. `supplier_ratings(id PK, workspace_id, supplier_id REFERENCES suppliers, rating INTEGER NOT NULL CHECK(rating BETWEEN 1 AND 5), feedback TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active' CHECK(status='active'), created_by TEXT NOT NULL, created_at, updated_at)` with no-update/no-delete triggers. Inventory retained supplier/category/review metadata too: add missing fields under Task 1’s contract; external registration sets supplier creator to supplier identity, category seeds use `system:seed`, immutable reviews use creator=actor_id and updated_at=created_at. Use explicit INSERT columns throughout.

- [ ] **Step 4: Implement**

Delete the `POST /api/erp/suppliers` branch. Review transitions: `pending→approved|rejected`, `approved→suspended`, `suspended→approved`, others 409 `'This supplier cannot move from <old> to <new>.'`; `reason()` required for `rejected` and `suspended`; keep the versioned update, `supplier_registration_reviews` insert (`reason ?? ''`) and category replacement. Append to `PENDING_SOURCES`: `{ objectType: 'supplier', role: 'purchase_manager', sql: "SELECT id, workspace_id, name AS label, created_at AS since FROM suppliers WHERE status='pending' AND created_at <= ?" }`. In `tests/procurement-api.test.mjs` the fixture's `approve()` signs in a `purchase_manager`, the categories assertion becomes 9, and the directory-create assertion becomes 404.

- [ ] **Step 5: Run all tests and e2e**

Run: `npm test && npx tsc -b && npx playwright test --project=desktop-chromium`
Expected: `fail 0`; tsc silent; Playwright `passed`, none failed.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0010_suppliers.sql server/procurement.mjs server/notify.mjs src/Procurement.tsx e2e/procurement.spec.ts tests/suppliers.test.mjs tests/portal-fixture.mjs tests/procurement-api.test.mjs
git commit -m "Let the purchase manager review, profile and rate suppliers, and add dye, chemical and packaging categories"
```

### Task 7: RFQs, bidding, award with the purchase threshold, POs and PO re-approval

**Files:**
- Create: `drizzle/0011_purchasing.sql`
- Create: `tests/purchasing.test.mjs`
- Modify: `server/procurement.mjs:59-187` (RFQ, bid and award routes; `approvalHandlers`; `purchasingScheduled`)
- Modify: `server/inventory.mjs` (merge `approvalHandlers`), `server/cloudflare.mjs` (`scheduled` adds `purchasingScheduled`), `server/notify.mjs` (`PENDING_SOURCES`)
- Modify: `tests/portal-fixture.mjs` (`insertBid`, `setThreshold`), `tests/procurement-api.test.mjs` (staff calls sign in as a purchase manager; legacy award tests leave the threshold unset, so awards stay immediate)
- Modify: `src/Procurement.tsx` (local `InterventionField` for every purchasing form; `BidDecision`: a 202 answer shows `t('Sent to the admin for approval. The purchase order is created once approved.', 'منظوری کے لیے ایڈمن کو بھیج دیا گیا۔ منظوری کے بعد خریداری آرڈر بنے گا۔')` instead of closing as saved)
- Modify: `e2e/procurement.spec.ts` (all admin purchasing forms supply intervention reasons; pending award assertions).

**Interfaces:**
- Consumes: `needsApproval`, `approvalQueries`, handler contract (Task 4), `notifyRole` (Task 5), supplier statuses (Task 6).
- Produces:
  - RFQ API status values: `draft | open | closed | awarded | cancelled` (`cancelled` = stored `closed` with `cancelled_at` set; an `open` row past `deadline_at` is reported `closed`).
  - `POST /api/erp/rfqs` (draft; `deliveryLocation` optional), `POST /api/erp/rfqs/publish {id}` (start bidding), `POST /api/erp/rfqs/close {id}`, `POST /api/erp/rfqs/cancel {id, reason}`, `POST /api/erp/bids/reject {id, version, reason}`, `POST /api/erp/bids/award {id, version}` → 201 `{ order }` or 202 `{ pendingApproval: true, approvalId }`, `POST /api/erp/orders/quantity {id, version, quantityMilli}` → 200 `{ order }` or 202 `{ pendingApproval: true, approvalId }`. All role `purchase_manager`; `GET /api/erp/procurement` viewer `purchase_manager`, with `currency: settings.currency` for form/display labels.
  - PO fields added: `quantity_milli`, `total_minor`, `approval_status ('approved'|'pending_admin')`, `bill_of_lading`, `version`, `updated_at`. `total_minor = Math.round(price_minor * quantity_milli / 1000)`.
  - `approvalHandlers = { purchase_award, po_change }` (purchase_award payload `{ bidId, bidVersion, termsSnapshot, currency }`, object `rfq`; po_change payload `{ quantityMilli, fromQuantityMilli, poVersion, currency }`, object `purchase_order`).
  - `purchasingScheduled(env, now = Date.now()) → Promise<{ closed: number }>`.
  - Fixture: `insertBid({ rfqId, supplierId, priceMinor = 125000, quantityMilli })`, `setThreshold(type, value)`.

- [ ] **Step 1: Write the failing tests** (`tests/purchasing.test.mjs`)

Common setup: approved cotton supplier, RFQ 100 kg (`quantityMilli: 100000`), published, one bid at `priceMinor: 125000` → total `12500000` (PKR 125,000).

```js
test('a bid below the purchase threshold creates the PO immediately', async () => {
  // setThreshold('purchase', 20000000); award → 201; order.total_minor 12500000, quantity_milli 100000, approval_status 'approved'; RFQ 'awarded'
});
test('at or above the threshold the award waits for admin and no PO exists until approval', async () => {
  // setThreshold('purchase', 12500000); award → 202 {pendingApproval:true}; COUNT(supplier_purchase_orders)=0
  // all three admins have 'award.pending_approval'; admin approves → PO total 12500000; audit 'po.created'; Pervaiz has 'approval.decided'
});
test('an admin rejection of an award needs a reason and leaves no PO', async () => {
  // reject without reason → 422; with 'Choose the local supplier this month' → 200; no PO; RFQ status unchanged; PM may award another bid
});
test('a PO quantity change at or above the threshold needs admin approval again', async () => {
  // threshold 15000000; immediate PO at 100 kg; quantity → 150000 gives total 18750000 → 202; PO still 100000 with approval_status 'pending_admin'
  // approve → quantity_milli 150000, total_minor 18750000, approval_status 'approved'; then 80000 (total 10000000) → 200 immediately; audit 'po.quantity_changed'
});
test('bidding moves draft → open → closed → awarded, and cancelling needs a reason', async () => {
  // publish → 'open'; close → 'closed'; cancel without reason → 422; with 'Requirement withdrawn' → GET shows 'cancelled'; award on it → 409
});
test('a bid rejection needs a reason and is audited', async () => { /* reject no reason 422; with reason → audit 'bid.rejected' reason */ });
test('the deadline ends bidding and notifies the purchase manager once', async () => {
  // purchasingScheduled(env, deadline + 1) → {closed:1}; RFQ 'closed'; Pervaiz has 'bidding.closed'; second run → {closed:0}
});
test('the RFQ goes only to approved suppliers in its category', async () => {
  // approved cotton + pending cotton + approved synthetic, none with portal accounts → publish → recipients 1
});
test('only purchase managers run purchasing; an admin needs an intervention reason', async () => {
  // quality_inspector POST /erp/rfqs → 403; admin without interventionReason → 422
});
```

Add `test('pending awards reject expired or changed bid terms atomically')`: mutate version or advance past valid_until before approval → 409, pending request and zero POs/effects; current terms succeed once. Add `test('PO quantity never falls below arrived quantity')`: before QC tables exist retain the existing goods-receipt lower bound; Task 9 extends it to QC lot quantities in the same transaction, including delayed approvals. Add `test('purchase managers read only their workspace pending awards')`: PM/admin → 200 with projection above, supervisor → 403, foreign workspace excluded. Add `test('admin legacy purchasing forms require intervention on every mutation')` in `e2e/procurement.spec.ts`, with missing reason blocked and valid reason saved/audited.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/purchasing.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Write `drizzle/0011_purchasing.sql`**

- `ALTER TABLE procurement_rfqs ADD COLUMN cancelled_at INTEGER`, `cancel_reason TEXT`, `closed_at INTEGER`, `updated_at INTEGER`.
- `ALTER TABLE supplier_purchase_orders ADD COLUMN quantity_milli INTEGER`, `total_minor INTEGER`, `approval_status TEXT NOT NULL DEFAULT 'approved' CHECK(approval_status IN ('approved','pending_admin'))`, `bill_of_lading TEXT NOT NULL DEFAULT ''`, `version INTEGER NOT NULL DEFAULT 1`, `updated_at INTEGER`; backfill only the new columns: `quantity_milli = json_extract(terms_snapshot,'$.quantity_milli')`, `total_minor = (json_extract(terms_snapshot,'$.price_minor') * json_extract(terms_snapshot,'$.quantity_milli') + 500) / 1000`, `updated_at = created_at` (the `purchase_terms_immutable` trigger watches other columns).
- `CREATE TRIGGER validate_purchase_order BEFORE INSERT ON supplier_purchase_orders` raising `'bid or supplier no longer valid'` unless the bid is `submitted`, its supplier `approved`, and its RFQ `open` or `closed` with `cancelled_at IS NULL` in the same workspace. The award path then uses a plain `INSERT … VALUES`, so an approval whose bid went stale fails the whole batch instead of silently creating nothing.

Pin `{bidId,bidVersion,termsSnapshot,currency}` in `purchase_award` and expected PO version plus currency in `po_change`. In the committing transaction, guard bid version, exact terms, `valid_until >= now`, submitted status, supplier approval and RFQ eligibility; stale/expired terms return 409 and leave the approval pending with no PO/audit/notification. PO-change application checks the pinned poVersion and fromQuantityMilli, rejecting a stale payload atomically; monetary effects also require payload.currency to match the current factory currency before applying monetary gates (409 otherwise), preserving request-time threshold and currency for review. The immediate path uses the same guards. `poInsertQueries(db,member,{bidId,bidVersion,termsSnapshot,currency},now) → Statement[]` owns those statements. `describe` for both types returns the Task 4 evidence contract. Add `GET /api/erp/orders/pending-approvals` (viewer purchase_manager/admin) → `{awards:[{approvalId,rfqId,bidId,bidVersion,amount,currency,threshold,status:'pending',created_at}], changes:[{approvalId,orderId,quantityMilli,fromQuantityMilli,amount,currency,threshold,status:'pending',created_at}]}` scoped to workspace, with no admin decision capability.

- [ ] **Step 4: Implement**

- Publish drops the `supplier_users` requirement; recipients are approved suppliers linked to the category. Audit `rfq.opened`.
- Close: `open → closed`, `closed_at=now`, notify `purchase_manager` `bidding.closed`, audit `rfq.closed`. Cancel: any state except `awarded`, `reason()`, audit `rfq.cancelled`.
- Bid reject allowed while the RFQ is `open` or `closed`; retain Task 2’s atomic rejection guard and use `audit(db,member,'bid.rejected',id,{},'staff',{reason,intervention})`.
- Award: compute the total; `needsApproval(db, w, 'purchase', total)`; below → `poInsertQueries(db, member, bid, now)` (PO insert with the new columns, RFQ `awarded`, audit `po.created`); at or above → `approvalQueries` type `purchase_award` and 202. The `purchase_award` handler's `approve` returns `poInsertQueries`; `reject` returns `[]`.
- PO quantity change: refuse while `approval_status='pending_admin'` (409). New total at or above the threshold → `approval_status='pending_admin'` plus `po_change` approval (202); else update `quantity_milli`, `total_minor`, `version` with audit `po.quantity_changed` (before/after). The handler's `approve` applies the stored payload quantity and sets `approval_status='approved'`; `reject` resets `approval_status='approved'`.
- `supplierOperations` bid insert (Task 15 moves it into `submitBid`) adds `notifyRole(…,'purchase_manager','bid.received','bid',id,rfq.reference)`.
- `purchasingScheduled`: close every `open` RFQ with `deadline_at <= now`, one batch per RFQ with the notification.
- `PENDING_SOURCES`: `{ objectType: 'rfq', role: 'purchase_manager', sql: "SELECT id, workspace_id, reference AS label, COALESCE(closed_at, deadline_at) AS since FROM procurement_rfqs WHERE status='closed' AND cancelled_at IS NULL AND EXISTS(SELECT 1 FROM supplier_bids WHERE rfq_id=procurement_rfqs.id AND status='submitted') AND COALESCE(closed_at, deadline_at) <= ?" }`.

Every legacy purchasing form in `src/Procurement.tsx` (RFQ create/publish/close/cancel, bid reject/award, PO quantity change) renders the same required intervention reason field for admins and sends `interventionReason`; every corresponding `keys()` allow-list accepts it. Use the local legacy `InterventionField` now; Task 17 consolidates it into `PortalCommon`. Update admin e2e setup to enter `Purchase manager not set up yet` on every affected action, and assert 202 keeps the pending award visible. The existing supplierOperations bid writer also enforces configured currency here, before Task 15 extracts it. Monetary checks use the configured currency; a bid/PO in another currency returns 409 before comparison, with no PO/request written. Migration 0011 also replaces the initial currency guard to account for cancelled RFQs and pending awards now that those columns/tables exist. It supplies missing RFQ/PO/bid/bid-history metadata, using explicit INSERT column lists; bid created_by is its authenticated supplier actor and bid-history status is fixed `recorded`, created_by=actor_id, updated_at=created_at.

- [ ] **Step 5: Run all tests and e2e**

Run: `npm test && npx tsc -b && npx playwright test --project=desktop-chromium`
Expected: `fail 0`; tsc silent; Playwright `passed`, none failed.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0011_purchasing.sql server/procurement.mjs server/inventory.mjs server/cloudflare.mjs server/notify.mjs src/Procurement.tsx tests/purchasing.test.mjs tests/portal-fixture.mjs tests/procurement-api.test.mjs e2e/procurement.spec.ts
git commit -m "Gate bid awards and PO quantity changes on the purchase threshold, and end bidding at the deadline"
```

### Task 8: B/L on the PO and shipment tracking with cached status

**Files:**
- Create: `server/datalooplabs.mjs` (copied verbatim from `/Users/anastabba/orca/workspaces/FYP/erp-tracking-dll/yarn-erp/server/datalooplabs.mjs`, 155 lines)
- Create: `server/tracking.mjs` (`trackingApi`, `sanitizeTrackingPayload`)
- Create: `drizzle/0012_shipments.sql`
- Create: `tests/tracking.test.mjs`
- Modify: `server/inventory.mjs` (`erp.shipments = trackingApi`), `server/procurement.mjs` (overview `tracking` field), `scripts/dev-server.mjs` (pass `DATALOOPLABS_API_KEY`, `DATALOOPLABS_CONTRACT` from `process.env`)

**Interfaces:**
- Consumes: PO rows (Task 7), `role`, `viewer`, `audit`.
- Produces:
  - From the copied adapter: `trackUnit(env, account, { identifier, identifier_type, carrier?, force_update? }, deps?) → Promise<{ containers, events: [{ at, title, code, location }], reference, dataAt, empty }>`; `ProviderProblem` with `kind` in `not_configured | contract_unavailable | ambiguous_timeout | network_error | rate_limited | credential_rejected | invalid_identifier | provider_unavailable | provider_rejection | garbled_response`; `credentialOf(env)`, `redact(value, env)`.
  - `accountFromEnv(env) → account | null`: parses the non-secret JSON var `DATALOOPLABS_CONTRACT` = `{ baseUrl, trackPath, request, response }` into `{ base_url, track_path, contract_json, contract_verified_at: 1 }`; null when absent or unparsable.
  - `trackingApi`: `POST /api/erp/shipments {id, orderId, billOfLading}` (attach B/L, role `purchase_manager`, audit `po.bl_attached`); `GET /api/erp/shipments?orderId=` → `{ shipments, tracking: { configured: boolean, provider: 'DataLoopLabs' } }`; `POST /api/erp/shipments/track {id}` → 200 `{ shipment, error?: string }` for provider outcomes; authorization/validation/not-found errors retain 403/422/404.
  - Shipment row: `{ id, purchase_order_id, bill_of_lading, status: 'not_checked'|'tracked'|'error', last_status_json, last_checked_at, last_error, created_at }`.

- [ ] **Step 1: Write the failing tests** (`tests/tracking.test.mjs`)

Use the contract from `/Users/anastabba/orca/workspaces/FYP/erp-tracking-dll/yarn-erp/tests/tracking-api.test.mjs:168-176` as `DATALOOPLABS_CONTRACT` (with `baseUrl: 'https://provider.test/v1', trackPath: '/tracking/track'`) and key `'dll_test_key_1234567890'`. Stub `globalThis.fetch` per test and restore it after.

```js
test('without a key tracking is not configured and makes no provider call', async () => {
  // valid contract, no key: track → 200, error 'Tracking is not configured: API key missing.'; fetch 0; fresh shipment.status 'not_checked'
});
test('without a usable contract tracking is not configured and makes no provider call', async () => {
  // valid key, missing or malformed contract: track → 200, error 'Tracking is not configured: provider contract unavailable.'; fetch 0; fresh status 'not_checked'
});
test('a successful lookup caches the status and the time it was checked', async () => {
  // fetch → 200 {containers:[{number:'MSCU1234567'}], events:[{eventTime:'2026-10-28T10:00:00Z', statusCode:'LOADED', statusDescription:'Loaded on vessel', location:'Karachi'}], referenceNumber:'BL123'}
  // shipment.status 'tracked'; JSON.parse(last_status_json).events[0].title 'Loaded on vessel'; last_checked_at >= before
});
test('when the provider fails the last cached status stays and an error is shown, never a 500', async () => {
  // after a success: fetch → 503 → status 200, data.error /Provider error/, last_status_json unchanged
  // fetch throws → 200 with error; fetch → 200 with body 'not json' → 200, error /could not be read/
});
test('the API key never reaches a response or a stored row', async () => {
  // fetch rejects with Error('bad Bearer dll_test_key_1234567890'); response text, GET /erp/shipments, GET /erp/procurement
  // and every column of shipments all exclude 'dll_test_key_1234567890'
});
test('the B/L number attaches to the PO; only purchase managers attach and track', async () => {
  // POST {billOfLading:' mscu bl 1234 '} → stored 'MSCUBL1234' and PO.bill_of_lading 'MSCUBL1234'; supervisor → 403
});
```

Add `test('successful provider echoes cannot leak the key')`: echo the key and `Bearer <key>` in each normalized string field, including container data; response, stored shipment columns, overview and captured logs exclude both secrets, while ordinary event data remains. Add `test('tracking preserves request errors')`: wrong role → 403, unknown/foreign shipment → 404, malformed id → 422; zero provider calls and no cache writes.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/tracking.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Copy the adapter and write the migration**

Run: `cp /Users/anastabba/orca/workspaces/FYP/erp-tracking-dll/yarn-erp/server/datalooplabs.mjs server/datalooplabs.mjs`
If that worktree is gone, check `git -C /Users/anastabba/orca/workspaces/FYP/erp-tracking stash list` and the sibling `erp-tracking` worktree for the same file; the Produces block above is the contract the adapter must keep.

`drizzle/0012_shipments.sql`: `shipments(id PK, workspace_id, purchase_order_id REFERENCES supplier_purchase_orders, bill_of_lading TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'not_checked' CHECK(status IN ('not_checked','tracked','error')), last_status_json TEXT, last_checked_at INTEGER, last_error TEXT, created_by TEXT NOT NULL, created_at, updated_at, UNIQUE(purchase_order_id, bill_of_lading))`.

- [ ] **Step 4: Implement `tracking.mjs`**

B/L: `text(value,'Bill of lading',3,100).toUpperCase().replace(/\s+/g,'')`. Track: `trackUnit(env, accountFromEnv(env), { identifier: bl, identifier_type: 'bol' })`. Authorize, validate input and look up the workspace shipment outside the provider catch (403/422/404 remain errors). Catch only provider lookup/normalization: `not_configured` maps to 'Tracking is not configured: API key missing.' and `contract_unavailable` to 'Tracking is not configured: provider contract unavailable.'; fresh status stays `not_checked`, cached status/data stay intact. Other provider failures return 200 with redacted error, keeping cache and using `error` only without cache. Before storing or returning successful normalized data, `sanitizeTrackingPayload(payload,env) → payload` recursively redacts every string (including containers, event titles/codes/locations and reference); store only that sanitized shape with `status='tracked'`, updated check time and cleared error. Database/programming errors are outside the provider catch. Overview `tracking.configured = !!credentialOf(env) && !!accountFromEnv(env)`. Ceiling to note in code: `// ponytail: one paid provider call per Track press; add the credit budget from the erp-tracking worktree if billing matters`.

- [ ] **Step 5: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

- [ ] **Step 6: Commit**

```bash
git add server/datalooplabs.mjs server/tracking.mjs drizzle/0012_shipments.sql server/inventory.mjs server/procurement.mjs scripts/dev-server.mjs tests/tracking.test.mjs
git commit -m "Attach B/L numbers to POs and track shipments through DataLoopLabs with a cached last status"
```

### Task 9: Lots, inspections, mandatory photos and issues

**Files:**
- Create: `drizzle/0013_quality.sql`
- Create: `server/photos.mjs`, `server/quality.mjs`
- Create: `tests/quality.test.mjs`
- Modify: `server/inventory.mjs:148-196` (the legacy `/api/photos` POST calls `readPhoto`; mount `erp.qc = qualityApi`). Legacy goods-receipt writes stop here: their replacement registers QC lots without inventory receipts; read-only history stays until Task 19 removes the old module.
- Modify: `tests/portal-fixture.mjs` (`insertPO`, `insertProduct`, `jpeg` bytes), `server/notify.mjs` (`PENDING_SOURCES`)
- Modify: `server/receiving.mjs` (reject superseded receipt writes), `server/procurement.mjs` (QC arrival lower bound for immediate/delayed PO changes), `src/IncomingStock.tsx` (register arrivals through `/erp/qc/lots`), `src/LiveApp.tsx` (replace inspector legacy QC controls with inspection/photo/issue submission), `tests/procurement-api.test.mjs`, `tests/inventory-api.test.mjs`, `e2e/procurement.spec.ts`, `e2e/inventory.spec.ts` (updated routes and regression assertions).

**Interfaces:**
- Consumes: POs and shipments (Tasks 7–8), `notifyRole`, `role`, `viewer`, `audit`.
- Produces:
  - `readPhoto(request) → Promise<{ form: FormData, bytes: Uint8Array, type: 'image/jpeg'|'image/png'|'image/webp', digest: string }>` (11 MB stream cap, 10 MB file cap, magic-byte check; same messages as today).
  - Tables `qc_lots`, `qc_inspections`, `qc_photos`, `qc_issues`, view `qc_lot_open(lot_id, open_milli)`.
  - `lotStatusQuery(db, lotId, now) → Statement` (sets `qc_lots.status` to `under_review` when an inspection is a draft or awaits a decision, else `awaiting_inspection` when `open_milli > 0`, else `settled`; sets `pending_since=now` only on entry/re-entry to awaiting_inspection, preserving it during the same pending episode).
  - Routes (`qualityApi`): `POST /api/erp/qc/lots {id, orderId, shipmentId, productId, reference, quantityMilli, supplierLot?, arrivedAt}` (role `purchase_manager`); `GET /api/erp/qc/lots?status=` (viewer `quality_inspector, supervisor, purchase_manager`); `POST /api/erp/qc/inspections {id, lotId, acceptedMilli, rejectedMilli, note?}`, `POST /api/erp/qc/photos` (multipart `inspectionId` or `issueId`, `photo`, client UUID `id`), `POST /api/erp/qc/issues {id, inspectionId, type, severity, description}`, `POST /api/erp/qc/inspections/submit {id}` (all role `quality_inspector`); `GET /api/erp/qc/inspections?mine=1&status=` (viewer `quality_inspector, supervisor`); `GET /api/erp/qc/photos/<id>` (viewer `quality_inspector, supervisor, purchase_manager`).
  - Severity values: `minor | major | critical`.
  - Fixture: `insertPO({ supplierId, priceMinor = 125000, quantityMilli = 100000, unit = 'kg' }) → Promise<{ orderId, shipmentId }>`, `insertProduct() → Promise<string>`, `jpeg: Uint8Array`.

- [ ] **Step 1: Write the failing tests** (`tests/quality.test.mjs`)

```js
test('the purchase manager registers an arrived lot linked to PO, shipment and supplier; inspectors are told', async () => {
  // POST /erp/qc/lots {quantityMilli:100000,...} → 201, status 'awaiting_inspection', supplier_id = PO supplier
  // Qasim (quality_inspector) has 'lot.ready'; a second lot of 1 kg on the same 100 kg PO → 409
});
test('the inspector records accepted and rejected quantity; partial acceptance is allowed', async () => {
  // {acceptedMilli:80000, rejectedMilli:20000} → 201 status 'draft'; {90000, 20000} on a fresh lot → 409 'More than the uninspected quantity.'
  // {0, 0} → 422
});
test('accepted quantity cannot be reported without a photo, and a rejection needs an issue', async () => {
  // submit → 422 'Upload at least one photo of the accepted quantity.'
  // upload jpeg → 201 {taken_at:number, lot_id: lot}; submit → 422 'Describe at least one issue for the rejected quantity.'
  // issue {type:'Shade variation', severity:'major', description:'Dye lot differs from the approved sample'} → 201; submit → 200
  // report_status 'pending', rejection_status 'pending'; every supervisor has 'inspection.submitted'; lot status 'under_review'
});
test('photos are JPEG, PNG or WebP and attach only to draft inspections', async () => {
  // bytes of 'hello' → 422 /Unsupported photo/; after submit an upload → 409
});
test('issue severity is minor, major or critical', async () => { /* 'severe' → 422 */ });
test('inspectors cannot add inventory or change catalogue items', async () => { /* Qasim POST /products → 403 */ });
test('a lot awaiting inspection over 24 hours reminds inspectors', async () => { /* created_at now-25h → Qasim gets 'reminder' */ });
```

Add `test('submitted inspection terms and transitions are immutable')`: seed a submitted 80/20 inspection; direct quantity/link/status reset writes throw, and the snapshot stays unchanged. Add `test('two submissions emit one audit and notification set')`: concurrent submit → [200,409], one submission audit and one notification per supervisor, statuses still pending. Add `test('identical photo bytes attach independently and retries are idempotent')`: two inspections and an issue on the same lot accept the same jpeg under distinct attachment ids; exact retry → 200 without extra row/blob; altered retry → 409. Add `test('QC arrival and PO reduction cannot overbook the order')`: race a 60kg arrival against reduction to 50kg; exactly one commits, including delayed approval. Assert legacy PM receive/QI qc cannot mutate inventory and the adapted arrival/submission screens work in e2e.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/quality.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Write `drizzle/0013_quality.sql`**

- `qc_lots(id PK, workspace_id, purchase_order_id REFERENCES supplier_purchase_orders, shipment_id REFERENCES shipments, supplier_id REFERENCES suppliers, product_id REFERENCES products, reference TEXT NOT NULL, quantity_milli INTEGER NOT NULL CHECK(quantity_milli > 0), unit TEXT NOT NULL CHECK(unit IN ('kg','tonne')), supplier_lot TEXT NOT NULL DEFAULT '', arrived_at INTEGER NOT NULL, pending_since INTEGER, status TEXT NOT NULL CHECK(status IN ('awaiting_inspection','under_review','settled')), created_by, created_at, updated_at, UNIQUE(workspace_id, reference))`; trigger `validate_qc_lot` (PO in workspace with `approval_status='approved'`, shipment belongs to the PO, supplier and unit match the PO, and the sum of lot quantities including the new one ≤ PO `quantity_milli`).
- `qc_inspections(id PK, workspace_id, lot_id REFERENCES qc_lots, accepted_milli INTEGER NOT NULL CHECK(accepted_milli >= 0), rejected_milli INTEGER NOT NULL CHECK(rejected_milli >= 0), note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL CHECK(status IN ('draft','submitted')), report_status TEXT CHECK(report_status IS NULL OR report_status IN ('pending','accepted','returned')), rejection_status TEXT CHECK(rejection_status IS NULL OR rejection_status IN ('pending','confirmed','dismissed','escalated')), dismiss_outcome TEXT CHECK(dismiss_outcome IS NULL OR dismiss_outcome IN ('re_inspect','accept_with_deviation')), report_reason TEXT, rejection_reason TEXT, decided_by TEXT, submitted_at, decided_at, created_by, created_at, updated_at, CHECK(accepted_milli + rejected_milli > 0))`.
- View `qc_lot_open`: `lot.quantity_milli` minus, over its inspections, `accepted_milli` when `status='draft' OR report_status IN ('pending','accepted')` and `rejected_milli` when `status='draft' OR rejection_status IN ('pending','confirmed','escalated') OR (rejection_status='dismissed' AND dismiss_outcome='accept_with_deviation')`. A returned report or a re-inspect dismissal frees its quantity for the next inspection.
- Trigger `validate_qc_inspection` BEFORE INSERT: `NEW.accepted_milli + NEW.rejected_milli <= open_milli` (`'More than the uninspected quantity.'`).
- Triggers enforce the full graph: inspection `draft→submitted` once; accepted side `NULL→pending` only on submission with accepted_milli>0, then `pending→accepted|returned`; rejected side `NULL→pending` only with rejected_milli>0, then `pending→confirmed|dismissed|escalated`, and `escalated→confirmed|dismissed` only via its admin approval. Zero-quantity sides remain NULL. No reverse transitions or same-state repeated decision writes. Freeze lot/workspace links and quantities on submission; draft changes recheck reserved quantity. Freeze submitted issue/photo evidence, quantities and links too; supervisor-owned issue disposition statuses may still follow the decision graph. Use an unconditional id-targeted transition UPDATE whose trigger validates OLD state and raises ABORT for a losing/repeated transition, so the entire batch and all side effects roll back; map conflicts to 409.
- `qc_issues(id PK, workspace_id, inspection_id REFERENCES qc_inspections, type TEXT NOT NULL, severity TEXT NOT NULL CHECK(severity IN ('minor','major','critical')), description TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','confirmed','dismissed','escalated')), created_by, created_at, updated_at)`.
- `qc_photos(id PK, workspace_id, lot_id REFERENCES qc_lots, inspection_id REFERENCES qc_inspections, issue_id REFERENCES qc_issues, object_key TEXT NOT NULL UNIQUE, content_type, content_hash, size, taken_at INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'attached' CHECK(status='attached'), created_by, created_at, updated_at, CHECK((inspection_id IS NOT NULL) != (issue_id IS NOT NULL)))` with no-update/no-delete triggers.

- [ ] **Step 4: Implement**

`readPhoto` is the body of the current `/api/photos` POST up to the digest; both that legacy route and `qualityApi` call it. Photo key `<workspace>/qc/<lotId>/<inspection|issue>/<attachmentId>/<digest>` separates attachment identity from content. Multipart includes client UUID `id`; retry with the same id/target/digest returns the existing attachment (200), conflicting target/digest returns 409. Identical bytes on another inspection/issue create a distinct attachment (201). Validate workspace and draft target before blob write; transaction rechecks target state and cleans up a newly orphaned blob on failure. `taken_at` is the server time. New awaiting-inspection lots initialize `pending_since=now`. Issue `type` is `text(…,'Issue type',2,80)`, description `multiline(…,5,2000)`. Submit sets `report_status='pending'` when `accepted_milli>0` and `rejection_status='pending'` when `rejected_milli>0`, plus `lotStatusQuery`, `notifyRole(…,'supervisor','inspection.submitted',…)`, audit `inspection.submitted`. Lot registration also updates the PO `status='received'` when its lots cover `quantity_milli`, notifies `quality_inspector` `lot.ready`, audits `lot.arrived`. `PENDING_SOURCES`: `{ objectType: 'qc_lot', role: 'quality_inspector', sql: "SELECT id, workspace_id, reference AS label, pending_since AS since FROM qc_lots WHERE status='awaiting_inspection' AND pending_since <= ?" }`.

Close PM `receive` and QI legacy `qc` bypasses now: `server/inventory.mjs` rejects PM `/movements` receive and QI `/quality`/legacy inspection writes with 403; legacy goods-receipt POST routes return 410 with the new QC-arrival destination. IncomingStock registers PO/shipment/product/quantity arrivals via `/erp/qc/lots`; the QI controls in LiveApp create draft inspections, attach photos/issues and submit through `/erp/qc/*`. Remove the old write buttons and adapt their tests in this task; readonly legacy evidence remains. On PO quantity updates/approval, migration 0013 adds a transactional lower-bound guard using registered QC quantities and any disjoint legacy receipt quantities (no double counting); reject reductions below arrivals with 409. Concurrent arrival versus reduction must leave a valid total. Both purchasing handlers implement this same guard. New tables all carry the Task 1 metadata contract; photos use fixed `attached` status and immutable timestamps.

- [ ] **Step 5: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

Also run: `npx playwright test --project=desktop-chromium`; expected all updated arrival/inspection workflows pass.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0013_quality.sql server/photos.mjs server/quality.mjs server/inventory.mjs server/notify.mjs tests/quality.test.mjs tests/portal-fixture.mjs server/receiving.mjs server/procurement.mjs src/IncomingStock.tsx src/LiveApp.tsx tests/procurement-api.test.mjs tests/inventory-api.test.mjs e2e/procurement.spec.ts e2e/inventory.spec.ts
git commit -m "Record lot inspections with accepted and rejected quantities, mandatory photos and issues"
```

### Task 10: Supervisor review, escalation and partial claims

**Files:**
- Create: `drizzle/0014_claims.sql`
- Create: `tests/claims.test.mjs`
- Modify: `server/quality.mjs` (review, rejection, claim routes; `decisionQueries`, `approvalHandlers`)
- Modify: `server/procurement.mjs` (`supplierPerformance` full version)
- Modify: `server/inventory.mjs` (merge handlers), `server/notify.mjs` (`PENDING_SOURCES`)
- Create: `server/stock-ledger.mjs` (shared atomic movement/delta statement builder).
- Modify: `tests/portal-fixture.mjs` (`submitted`), `src/LiveApp.tsx` (minimal supervisor review actions replace legacy QC toggles), `tests/inventory-api.test.mjs`, `e2e/inventory.spec.ts` (superseded QC/receive assertions).

**Interfaces:**
- Consumes: Task 9 tables and `lotStatusQuery`, `needsApproval`, `approvalQueries`, `notifyRole`.
- Produces:
  - `lots` gains `inventory_type ('raw'|'finished')` and `source ('qc_lot'|'production')`. An inventory lot created from QC uses the QC lot's id as its `lots.id` and the QC `reference` as its `batch`.
  - Routes: `GET /api/erp/qc/reports`, `GET /api/erp/qc/rejections` (viewer `supervisor`); `POST /api/erp/qc/reports/decide {inspectionId, decision: 'accept'|'reject', reason?}`; `POST /api/erp/qc/rejections/decide {inspectionId, decision: 'confirm'|'dismiss'|'escalate', dismissOutcome?: 're_inspect'|'accept_with_deviation', reason?}` (role `supervisor`); `GET /api/erp/qc/claims`, `GET /api/erp/qc/claims/<id>` (viewer `purchase_manager`, which sees only `decided` claims; admin sees all statuses, scoped to workspace); `POST /api/erp/qc/claims/decide {id, outcome: 'return'|'replacement'|'claim', adjustedMinor?, reason?}` (role `admin`).
  - `claimAmount(rejectedMilli, priceMinor) = Math.round(rejectedMilli * priceMinor / 1000)` (exported).
  - `approvalHandlers = { claim, escalation }`.
  - `supplierPerformance(db, supplierId) → Promise<{ manualAverage, ratingCount, qcPassRate: number | null, onTimeRate: number | null, claims: { return: number, replacement: number, claim: number } }>`.
  - Fixture: `submitted({ acceptedMilli, rejectedMilli }) → Promise<{ lotId, inspectionId }>` (lot + photo + issue + submit).

Additional produced helpers: `server/stock-ledger.mjs`: `movementQueries(db,member,{id,lotId,action,stage,deltaGrams,note,sourceId},now) → Statement[]` validates movement/delta agreement, creates exactly one movement and its matching delta atomically, preserving ledger immutability and non-negative balances. Domain modules own authorization, thresholds and disposition; this helper owns only movement/delta construction. `server/quality.mjs`: `decisionQueries(db,member,{inspectionId,side,expectedStatus,nextStatus,dismissOutcome?,reason?,intervention?,claim?},now) → Promise<Statement[]>` owns guarded transition plus lot status, related issue statuses, notification and audit for all direct and approval decisions.

- [ ] **Step 1: Write the failing tests** (`tests/claims.test.mjs`)

Values: PO rate `125000` per kg, inspection 80 kg accepted / 20 kg rejected → claim `2500000`.

```js
test('the supervisor accepts a report and the accepted quantity becomes QC-approved raw inventory', async () => {
  // accept → balances(lot,'raw').grams 80000; lots row {quality:'approved', inventory_type:'raw', source:'qc_lot', batch: reference}; Qasim has 'inspection.decided'
});
test('a report rejection needs a reason and returns it for re-inspection', async () => {
  // reject without reason → 422; with 'Photos are too dark to judge shade' → report_status 'returned'; qc_lot_open = 80000; a new 80000 inspection → 201
});
test('a confirmed rejection below the claim threshold creates the claim at rejected quantity × PO rate', async () => {
  // setThreshold('claim', 3000000); confirm → claim {rejected_milli:20000, po_rate_minor:125000, calculated_minor:2500000, status:'open'}; admins and Pervaiz (notice only) have 'claim.created'
});
test('at or above the claim threshold the claim waits for admin approval', async () => {
  // setThreshold('claim', 2500000); confirm → claim 'pending_approval', approval {type:'claim', amount:2500000}; approve → 'open'; reject (reason) → 'rejected'
});
test('a dismissal needs a reason and an outcome', async () => {
  // dismiss without reason → 422; without dismissOutcome → 422
  // accept_with_deviation → raw grams +20000, movement note contains 'Accepted with deviation'; re_inspect → qc_lot_open back to 20000; Qasim 'inspection.decided'
});
test('escalation goes to admin: approval confirms with a claim, rejection dismisses for re-inspection', async () => {
  // escalate → approval type 'escalation' amount 2500000, rejection_status 'escalated'; approve → claim 'open', rejection_status 'confirmed'
  // on another inspection: reject 'Supplier sent the right shade' → rejection_status 'dismissed', dismiss_outcome 're_inspect'
});
test('the admin decides the outcome; an adjusted amount needs a reason and the log keeps both amounts', async () => {
  // decide {outcome:'claim', adjustedMinor:2000000} → 422; with reason 'Supplier credited part in advance' → 200
  // audit 'claim.adjusted': old_json {"amount":2500000}, new_json {"amount":2000000}, reason, actor admin; Pervaiz has 'claim.decided'; second decide → 409
});
test('the purchase manager sees claim notices but cannot decide', async () => { /* PM GET decided claims 200; POST decide → 403 */ });
test('supervisor decisions are final for lower roles', async () => {
  // Qasim POST reports/decide → 403; supervisor deciding an accepted report again → 409
});
test('claim outcomes and the QC pass rate feed the supplier profile', async () => {
  // after one claim decided 'claim': performance.qcPassRate 0.8, claims {return:0, replacement:0, claim:1}
});
```

Add `test('concurrent supervisor decisions have one complete effect')`: accept versus return and confirm versus dismiss each yield [200,409], one receipt/claim at most and one decision audit/notification set. Add `test('every direct and escalated disposition updates issues and lot availability')`: assert issue status, lot status/open_milli and inspector notification for every branch, including rejected escalation reinspection. Add `test('QC pass rate uses final lot disposition once')`: wholly accepted→1, wholly rejected→0, settled 80/20→0.8, returned then re-inspected 100 accepted→1, pending-only→null. Add `test('a conflicting legacy batch cannot create a QC receipt')`: seed another lot with the reference, accept→409 and unchanged lot/stock/report/audit. Admin claims GET includes open/pending/decided; PM includes decided only.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/claims.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Write `drizzle/0014_claims.sql`**

- `ALTER TABLE lots ADD COLUMN inventory_type TEXT CHECK(inventory_type IS NULL OR inventory_type IN ('raw','finished'))`; `ALTER TABLE lots ADD COLUMN source TEXT CHECK(source IS NULL OR source IN ('qc_lot','production'))`.
- `claims(id PK, workspace_id, lot_id REFERENCES qc_lots, inspection_id TEXT NOT NULL UNIQUE REFERENCES qc_inspections, supplier_id, purchase_order_id, rejected_milli INTEGER NOT NULL, po_rate_minor INTEGER NOT NULL, calculated_minor INTEGER NOT NULL, adjusted_minor INTEGER, outcome TEXT CHECK(outcome IS NULL OR outcome IN ('return','replacement','claim')), adjust_reason TEXT, status TEXT NOT NULL CHECK(status IN ('pending_approval','open','decided','rejected')), decided_by, decided_at, created_by, created_at, updated_at)`; triggers: `claims_final` (no update once `decided` or `rejected`), `claims_amount_immutable` (`calculated_minor`, `rejected_milli`, `po_rate_minor`), `claims_adjust_reason` (`adjusted_minor` differing from `calculated_minor` with `adjust_reason` shorter than 5 → `'reason required'`), no-delete.

- [ ] **Step 4: Implement**

- Report accept batch: resolve `lots.id=qc lot id` explicitly; if present require matching workspace, product, batch/reference and source `qc_lot`. Otherwise insert it (quality `approved`, inventory_type `raw`, source `qc_lot`) with targeted `ON CONFLICT(id) DO NOTHING` followed by a transactional identity guard. A different lot with the same batch is a 409, never ignored. Build the raw receipt through `movementQueries` with `grams = accepted_milli × (unit==='tonne' ? 1000 : 1)`, `report_status='accepted'`, `lotStatusQuery`, notify `quality_inspector` `inspection.decided`, audit `inspection_report.accepted`. Reject: `reason()`, `report_status='returned'`, audit `inspection_report.rejected`.
- Confirm: rate and immutable currency from PO terms; require that currency to match settings before comparing a monetary claim threshold (409 `'PO currency differs from the configured factory currency.'`, no claim/decision effect otherwise); rate from `json_extract(terms_snapshot,'$.price_minor')`; `needsApproval('claim', amount)`; claim `open`, or `pending_approval` + `approvalQueries` type `claim`; either way notify `admin` and `purchase_manager` `claim.created` (spec 3.2 and 6: the purchase manager gets a notice when a claim is raised and when it is decided); issues `confirmed`; audit `rejection.confirmed`. Dismiss: `reason()` and `dismissOutcome` required; `accept_with_deviation` adds the rejected grams to raw stock with note `Accepted with deviation: <reason>`; audit `rejection.dismissed`. Escalate: `approvalQueries` type `escalation`, amount = the would-be claim, `rejection_status='escalated'`, audit `rejection.escalated`.
- Handlers: `claim.approve` → `status='open'`; `claim.reject` → `status='rejected'` (the rejection stays confirmed, nothing is claimed); `escalation.approve` → claim `open` + `rejection_status='confirmed'`; `escalation.reject` → `rejection_status='dismissed'`, `dismiss_outcome='re_inspect'`, `rejection_reason` = the admin's reason.
- Claim decide (admin only): outcome required; audit `claim.decided` (before `{amount: calculated}`, after `{amount, outcome}`); when adjusted, also audit `claim.adjusted` with the reason; notify `purchase_manager` `claim.decided`.
- `supplierPerformance`: `qcPassRate` = final accepted quantity ÷ (final accepted + final confirmed rejected quantity), aggregated over settled lots; pending lots are excluded, zero denominator returns null. Count accepted reports and `accept_with_deviation` as accepted, confirmed rejections as rejected, returned/re_inspect quantities as neither until their replacement inspection settles them. NULL sides with zero quantity are not applicable and do not exclude wholly accepted/rejected lots; no quantity is counted twice across reinspections; `onTimeRate` = share of QC lots with `arrived_at <= bid delivery_at` from the PO terms; `claims` counts decided outcomes.
- `PENDING_SOURCES`: pending reports and pending rejections → `supervisor` (since `submitted_at`); `open` claims → `admin` (since `updated_at`).

Every report accept/reject, rejection confirm/dismiss/escalate and escalation approve/reject calls `decisionQueries` in its single transaction. It applies Task 9's transition guard first, updates related issues (confirmed/dismissed/escalated), calls `lotStatusQuery`, emits one `inspection.decided` notification per inspector and a reasoned domain audit. Returned/re_inspect quantities make the lot awaiting_inspection when no other review remains, otherwise under_review; all consumed quantities make it settled. Receipts for both accepted reports and deviation acceptance call `movementQueries`; no copied ledger INSERT variants. Claim/escalation `describe` supplies Task 4 evidence. Close all remaining legacy raw-receive and `/quality` mutations here (410 with replacement route), including admin calls: raw can enter only via guarded report decisions. LiveApp replaces supervisor QC toggles with report Accept/Reject and rejection Confirm/Dismiss/Escalate, including reason/intervention fields; inventory tests/e2e use these flows. Claims and new lot metadata follow Task 1. Admin corrections never edit decided inspections: a reasoned new stock adjustment through Task 11’s owning route records the compensation and original inspection/claim id, with no reopening or recounting of settled inspection quantities; no reused decision or hidden history rewrite.

- [ ] **Step 5: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

Also run: `npx playwright test --project=desktop-chromium`; expected supervisor replacement controls pass.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0014_claims.sql server/quality.mjs server/procurement.mjs server/inventory.mjs server/notify.mjs tests/claims.test.mjs tests/portal-fixture.mjs server/stock-ledger.mjs src/LiveApp.tsx tests/inventory-api.test.mjs e2e/inventory.spec.ts
git commit -m "Add supervisor review, escalation and partial claims decided by the admin"
```

### Task 11: Supervisor inventory, adjustments, stock queries and the report to admin

**Files:**
- Create: `drizzle/0015_stock.sql`
- Create: `server/stock.mjs`
- Create: `tests/stock.test.mjs`
- Modify: `server/inventory.mjs` (`/api/products` uses `role(member, data, 'supervisor', 'purchase_manager')`; mount `erp.stock`; merge handlers). Legacy stock route stubs/read history remain until Task 21; superseded mutation bypasses are closed now or in Tasks 9–10, with dispatch closure owned by Task 14.
- Modify: `server/notify.mjs` (`PENDING_SOURCES`)
- Modify: `tests/portal-fixture.mjs` (`addFinished`), `src/LiveApp.tsx` (legacy stock forms delegate to supervisor finished/adjustment APIs; all stages remain visible), `tests/inventory-api.test.mjs`, `e2e/inventory.spec.ts`, `e2e/every-button.spec.ts` (guarded stock workflow).

**Interfaces:**
- Consumes: `lots.inventory_type/source` (Task 10), movement ledger triggers, `needsApproval`, `approvalQueries`, `notifyRole`.
- Produces:
  - `GET /api/erp/stock` → `{ lots: [{ id, batch, product_name, inventory_type, source, quality, raw_grams, cops_grams, wip_grams, finished_grams, legacyReadOnly: boolean }] , adjustmentThreshold: {value: number | null, unit: 'grams'} }` (viewer `supervisor`).
  - `POST /api/erp/stock/finished {id, productId, batch, grams, cartons?, cones?, note?}` (role `supervisor`).
  - `adjustmentQueries(db, member, { id, lotId, stage, deltaGrams, reason, source }, now) → Statement[]` (exported; calls Task 10 `movementQueries` — `waste` when negative, `receive` when positive — and sets the adjustment `applied` with its movement id).
  - `POST /api/erp/stock/adjustments {id, lotId, stage: 'raw'|'finished', kind: 'adjustment'|'write_off', deltaGrams, reason, compensatesId?}` → 201 `{ adjustment }` or 202 `{ pendingApproval: true, approvalId }` (role `supervisor`).
  - `GET /api/erp/stock/queries`, `POST /api/erp/stock/queries {id, productId, quantityMilli?, buyerRfqId?, question}` (role `sales_manager`), `POST /api/erp/stock/queries/answer {id, availableGrams, answer?}` (role `supervisor`).
  - `GET /api/erp/stock/reports/draft?from=&to=` → `{ confirmedRejections, escalations, adjustments }`; `POST /api/erp/stock/reports {id, from, to, flagged: [{objectType, objectId, note}], note?}`; `GET /api/erp/stock/reports` (viewer `supervisor`, admin sees all); `GET /api/erp/stock/history` (the caller's own audit rows).
  - `approvalHandlers = { inventory_adjustment }`.
  - Fixture: `addFinished({ grams = 10000 }) → Promise<string>` (product + finished lot as a supervisor).

- [ ] **Step 1: Write the failing tests** (`tests/stock.test.mjs`)

```js
test('only the supervisor adds inventory; finished goods record type and source', async () => {
  // inspector, purchase manager, sales manager, dispatch → 403; supervisor → 201
  // lots row {inventory_type:'finished', source:'production', quality:'approved'}; balances finished grams 10000
});
test('adjustments need a reason; below the threshold they apply at once', async () => {
  // setThreshold('inventory_adjustment', 10000); write_off -5000 without reason → 422; with 'Water damage in bay 3' → 201 status 'applied'
  // finished grams 5000; movement action 'waste' with note 'Water damage in bay 3'; audit 'inventory.adjusted' with reason
});
test('at or above the adjustment threshold nothing changes until admin approves', async () => {
  // -10000 → 202; grams unchanged; approve → grams lower by 10000; another at threshold rejected with a reason → unchanged
});
test('adjustments cannot make stock negative', async () => { /* -999999 → 409 'This would make stock negative.'; no applied row */ });
test('sales asks a stock query and the supervisor answers with the available quantity', async () => {
  // Sana (sales_manager) POST → 201, supervisors have 'stock_query.created'; answer {availableGrams:80000} → Sana's GET shows 80000
  // Danish (dispatch) POST → 403
});
test('the supervisor report bundles confirmed rejections, escalations, adjustments and flagged items; admin reads it', async () => {
  // with one confirmed rejection and one adjustment in range: draft counts 1/0/1; POST → 201; admin GET lists it
  // UPDATE supervisor_reports → throws /immutable report/
});
test('decision history lists only the supervisor\'s own decisions', async () => { /* two supervisors; each sees only own rows */ });
test('the stock ledger stays immutable', async () => {
  assert.throws(() => f.sql.exec('DELETE FROM movements'), /immutable/);
  assert.throws(() => f.sql.exec('UPDATE stock_deltas SET grams = 1'), /immutable/);
});
```

Add `test('all legacy stage balances remain readable but new writes use raw or finished')`: seed balances raw=1000,cops=2000,WIP=3000,finished=4000; assert all four exact API values, unsupported stage mutation→422 and all balances unchanged. Add `test('supervisors read threshold previews without admin settings access')`: stock response includes value=10000/unit=grams (or null when unset); supervisor admin-threshold GET→403, dispatch stock GET→403. Add `test('reasoned admin compensation preserves the original decision')`: new linked adjustment without reason→422; with reason/intervention below threshold→201, original record/audit unchanged, distinct compensating audit. Seed a movement and delta before ledger immutability attempts; snapshot and assert unchanged after each error. Seed the report before its UPDATE attempt and assert unchanged contents.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/stock.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Write `drizzle/0015_stock.sql`**

- `inventory_adjustments(id PK, workspace_id, lot_id REFERENCES lots, stage TEXT NOT NULL CHECK(stage IN ('raw','finished')), kind TEXT NOT NULL CHECK(kind IN ('adjustment','write_off')), delta_grams INTEGER NOT NULL CHECK(delta_grams != 0), reason TEXT NOT NULL CHECK(length(trim(reason)) >= 5), status TEXT NOT NULL CHECK(status IN ('pending_approval','applied','rejected')), source TEXT NOT NULL DEFAULT 'supervisor' CHECK(source IN ('supervisor','stock_issue')), compensates_id TEXT, movement_id TEXT REFERENCES movements(id), created_by, created_at, updated_at, decided_by, decided_at, CHECK(kind = 'adjustment' OR delta_grams < 0))`; trigger: no update once `applied` or `rejected`.
- `stock_queries(id PK, workspace_id, product_id REFERENCES products, quantity_milli INTEGER, buyer_rfq_id TEXT REFERENCES buyer_purchase_orders(id), question TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','answered')), available_grams INTEGER CHECK(available_grams IS NULL OR available_grams >= 0), answer TEXT, answered_by, answered_at, created_by, created_at, updated_at)`.
- `supervisor_reports(id PK, workspace_id, period_from INTEGER NOT NULL, period_to INTEGER NOT NULL, content_json TEXT NOT NULL, flagged_json TEXT NOT NULL DEFAULT '[]', note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'submitted' CHECK(status='submitted'), created_by, created_at, updated_at)` with no-update/no-delete triggers raising `'immutable report'`.

- [ ] **Step 4: Implement**

Adjustment amount for the threshold is `Math.abs(deltaGrams)`. A batch failing on the `balances` CHECK maps to 409 `'This would make stock negative.'`. The draft report assembles: inspections with `rejection_status='confirmed'` in range (with `rejection_reason`, issue rows and `qc_photos` ids), `rejection_status='escalated'` rows, and `inventory_adjustments` in range; the POST stores that snapshot plus `flagged` (each `note` 3–500 chars, at most 50 items). `PENDING_SOURCES`: open stock queries → `supervisor`; pending adjustments are already covered by approvals.

Consume `movementQueries` from `server/stock-ledger.mjs` for finished receipts and all adjustments; ledger construction has one owner. Close legacy general receive/produce/transfer/waste/reversal/lot-create writes (410), retaining only the explicitly temporary immediate dispatch path until Task 14. LiveApp offers supervisor finished-goods entry and threshold-gated adjustments through `/erp/stock/*` with reasons, instead of legacy stock mutation forms; catalogue roles stay as specified. Keep all raw/cops/WIP/finished balances readable (map the legacy WIP stage key to `wip_grams`); cops/WIP have no new mutation controls and any attempted new workflow write returns 422 `'Legacy cops/WIP stock is read-only; an authorized migration is required.'` No automatic conversion or data deletion. `inventory_adjustment.describe` supplies lot, stage, current balance, proposed delta/reason and threshold. `GET /erp/stock` returns the scoped adjustment-threshold preview to supervisor/admin only; other roles get 403. `GET /stock/queries` permits supervisor/admin to see workspace queries and sales_manager to see only their own; writes remain role guarded. Admin compensation uses `/stock/adjustments` with a new id, `compensatesId`, reason and interventionReason, retaining original movement/decision and auditing the link; normal thresholds still apply.

- [ ] **Step 5: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

Also run: `npx playwright test --project=desktop-chromium`; expected the revised legacy stock forms pass.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0015_stock.sql server/stock.mjs server/inventory.mjs server/notify.mjs tests/stock.test.mjs tests/portal-fixture.mjs src/LiveApp.tsx tests/inventory-api.test.mjs e2e/inventory.spec.ts e2e/every-button.spec.ts
git commit -m "Give the supervisor sole control of inventory with threshold-gated adjustments, stock queries and reports"
```

### Task 12: Buyers, buyer RFQs, quotations, sale noting, invoices and credit notes

The sales tables arrive on the live D1 with `0004` at Task 1's deploy and the legacy Sales tab was removed in Task 1, so no live user depends on the legacy sales routes this task replaces.

**Files:**
- Create: `drizzle/0016_sales_portal.sql`
- Create: `tests/sales.test.mjs`
- Delete: `tests/sales-api.test.mjs` (its Karachi due-date and money assertions are ported into `tests/sales.test.mjs`)
- Modify: `server/sales.mjs` (buyer review, quotes, `recordAcceptance`, `noteSale`, invoice document, credit notes; delete staff buyer creation, staff RFQ entry, `confirmApprovedRevision`, outbox, dispatch/delivery/correction/payment routes and `salesScheduled`)
- Modify: `server/buyer-portal.mjs` (`/api/buyer/approve` calls `recordAcceptance`), `server/cloudflare.mjs` (drop `salesScheduled`), `server/inventory.mjs` (mount `erp.sales = salesApi` in the `erp` map), `server/notify.mjs` (`PENDING_SOURCES`)
- Modify: `tests/portal-fixture.mjs` (`insertBuyer`, `insertBuyerRfq`, `acceptedQuote`)
- Modify: `server/governance.mjs`, `server/admin.mjs`, `tests/thresholds.test.mjs` (extend currency-change guards to new sales accounting).

**Interfaces:**
- Consumes: `settingsOf`, `notifyRole`, `role`, `viewer`, `reason`, `audit`, `karachiDate`, `dueAt` (existing in `server/sales.mjs`).
- Produces:
  - Buyer statuses keep their stored values; the API and UI call `active` "approved".
  - Buyer RFQ (`buyer_purchase_orders`) API `state`: `awaiting_buyer_approval` (buyer pending, status `entered`), `open` (`entered`), `quoted`, `sold` (`confirmed`), `closed` (`cancelled`).
  - `POST /api/erp/sales/buyers/review {id, status: 'active'|'rejected'|'suspended', reason?, version}` (role `sales_manager`).
  - `POST /api/erp/sales/quotes {id, poId, priceMinor, specifications, requestedDeliveryAt, paymentTerms, creditDays, note?, productId?}` and `POST /api/erp/sales/quotes/send {id}` (role `sales_manager`); the currency comes from `settingsOf`.
  - `recordAcceptance(db, { workspaceId, revisionId, version, buyerId, acceptedBy, note = '', now }) → Promise<{ acceptance, already: boolean }>`.
  - `noteSale(db, member, { id, revisionId }, now = Date.now()) → Promise<{ order, invoice }>`; `POST /api/erp/sales/sales {id, revisionId}` (role `sales_manager`).
  - Invoice fields added: `subtotal_minor`, `tax_rate_bp`, `tax_minor`, `due_at`, `payment_terms`, `credit_days`. `tax_minor = Math.floor((subtotal_minor * tax_rate_bp + 5000) / 10000)`; `total_minor = subtotal_minor + tax_minor`; `due_at = dueAt(issued_at, credit_days)`. Legacy rows read `subtotal_minor ?? total_minor` and tax 0.
  - `POST /api/erp/sales/credit-notes {id, invoiceId, amountMinor, reason}` → number `CN-<invoice number>-<n>` (role `sales_manager`).
  - `GET /api/erp/sales` → `{ buyers, rfqs, revisions, acceptances, orders, invoices, creditNotes, products, settings }` (viewer `sales_manager`); `GET /api/erp/sales/invoices/<id>` → HTML document.
  - Fixture: `insertBuyer({ status = 'pending' }) → Promise<string>`, `insertBuyerRfq({ buyerId, quantityMilli = 100000, unit = 'kg' }) → Promise<string>`, `acceptedQuote({ priceMinor = 125000, creditDays = 30 }) → Promise<{ buyerId, rfqId, revisionId }>`.

- [ ] **Step 1: Write the failing tests** (`tests/sales.test.mjs`)

Values: 100 kg at `priceMinor 125000` → subtotal `12500000`, GST `2250000`, total `14750000`.

```js
test('the sales manager approves or rejects pending buyers; rejection needs a reason and closes their RFQs', async () => {
  // Sana = person('Sana','sales_manager'); buyer pending with one RFQ; reject without reason → 422
  // with 'NTN does not match the company' → buyer 'rejected', RFQ status 'cancelled' (state 'closed'); audit 'buyer.rejected'
});
test('RFQs from pending buyers wait as awaiting buyer approval and cannot be quoted', async () => {
  // GET /erp/sales rfq.state 'awaiting_buyer_approval'; quote → 409 'Respond only to RFQs from approved buyers.'
  // approve buyer → Sana has 'buyer_rfq.received' for that RFQ; quote → 201
});
test('a quotation carries rate, specifications, payment terms and credit days in the factory currency', async () => {
  // body with currency:'USD' → 422 (unexpected field); revision.currency 'PKR'; credit_days 30; creditDays 400 → 422
});
test('a sale is noted only after the buyer accepts, and its invoice carries 18% GST', async () => {
  // noteSale before acceptance → 409 'The buyer has not accepted this quotation yet.'
  // recordAcceptance then POST /erp/sales/sales → 201; invoice {subtotal_minor:12500000, tax_rate_bp:1800, tax_minor:2250000, total_minor:14750000, currency:'PKR'}
  // invoice.number === `INV-${karachiDate(now).slice(0,4)}-0001`; due_at === dueAt(issued_at, 30); audit 'sale.noted' and 'invoice.issued'
});
test('invoice numbers run INV-YYYY-NNNN and restart each Karachi calendar year', async () => {
  // noteSale(..., Date.UTC(2026,11,31,18,0)) → 'INV-2026-0001'; Date.UTC(2026,11,31,19,30) (00:30 PKT on 1 Jan) → 'INV-2027-0001'; next → 'INV-2027-0002'
});
test('two sales noted at once never share a number', async () => {
  const [a, b] = await Promise.all([noteSale(db, sana, x), noteSale(db, sana, y)]);
  assert.notEqual(a.invoice.number, b.invoice.number);
});
test('admin-edited format and tax rate apply to the next invoice; currency follows its accepted quotation', async () => {
  // with no currency blockers, choose USD before creating/sending/accepting the next quote; invoice remains USD even if settings later change.
  // settings invoice_format 'FAZ-{YYYY}-{NNNN}', tax_rate_bp 1700 → next number 'FAZ-2026-000N' pattern /^FAZ-\d{4}-\d{4}$/, tax_minor 2125000
});
test('issued invoices are locked; corrections are credit notes with a reason', async () => {
  assert.throws(() => sql.exec('UPDATE invoices SET total_minor=1'), /invoices are immutable/);
  // credit note without reason → 422; {amountMinor:1000000, reason:'Two cones short on delivery'} → 201 number 'CN-<invoice number>-1'
  // a second note larger than the remaining 13750000 → 409; audit 'invoice.credited' with reason
});
test('only sales managers quote and note sales; dispatch cannot change invoices, prices or terms', async () => {
  // Danish (dispatch) POST quotes → 403, sales → 403, credit-notes → 403
});
test('staff cannot create buyers or enter buyer RFQs', async () => { /* POST /erp/sales/buyers → 404; /erp/sales/pos → 404 */ });
test('due dates are the Karachi date plus the credit days, across month and year ends', () => {
  // port of the old test: dueAt(Date.UTC(2026,0,31,20,0), 30) === Date.UTC(2026,2,3,18,59,59,999) /* 2026-03-03T18:59:59.999Z */, and the Dec→Jan case
});
```

Add `test('accepted credit days and buyer eligibility are guarded atomically')`: seed/send/accept 30-day quote, UPDATE credit_days→throws and unchanged 30; suspended or foreign buyer acceptance→409/404, no acceptance/audit; suspend after acceptance then note sale→409 without order/invoice. Add `test('accept versus resend cannot accept superseded terms')`: race acceptance of sent v1 with publication of v2; one wins, the other 409; if v2 wins no v1 acceptance, if acceptance wins v2 is not sent. Existing immutability test first notes a real sale, snapshots the invoice, attempts UPDATE and verifies unchanged row. Assert the January due-date value is exactly `2026-03-03T18:59:59.999Z`; preserve existing `dueAt` semantics.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/sales.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Write `drizzle/0016_sales_portal.sql`**

- `ALTER TABLE sales_quote_revisions ADD COLUMN credit_days INTEGER NOT NULL DEFAULT 30 CHECK(credit_days BETWEEN 0 AND 365)`.
- `ALTER TABLE invoices ADD COLUMN` `subtotal_minor INTEGER`, `tax_rate_bp INTEGER NOT NULL DEFAULT 0`, `tax_minor INTEGER NOT NULL DEFAULT 0`, `due_at INTEGER`, `payment_terms TEXT NOT NULL DEFAULT ''`, `credit_days INTEGER`, `locked INTEGER NOT NULL DEFAULT 1 CHECK(locked = 1)` (spec 5's locked flag; `invoices_immutable_update` is what enforces it). No backfill: `invoices_immutable_update` forbids it, and no invoice exists on the live D1.
- `quotation_acceptances(id PK, workspace_id, revision_id TEXT NOT NULL UNIQUE REFERENCES sales_quote_revisions(id), buyer_id REFERENCES buyers, version INTEGER NOT NULL, accepted_by TEXT NOT NULL, created_by TEXT NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'accepted' CHECK(status='accepted'), created_at, updated_at)` with no-update/no-delete triggers. (`buyer_approvals.user_id` requires a portal account, which the integration API does not have.)
- `credit_notes(id PK, workspace_id, invoice_id REFERENCES invoices, number TEXT NOT NULL, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), reason TEXT NOT NULL CHECK(length(trim(reason)) >= 5), status TEXT NOT NULL DEFAULT 'issued' CHECK(status='issued'), created_by, created_at, updated_at, UNIQUE(workspace_id, number))`; trigger `validate_credit_note` (amount ≤ invoice total − earlier credit notes); no-update/no-delete triggers.

Migration 0016 adds a `credit_days` immutability trigger covering every saved revision, matching existing quoted-term immutability; draft/sent/approved terms cannot be rewritten. Add a transactionally guarded current sent revision/version on the owning buyer RFQ (or extend its existing version guard): publishing advances that pointer only while unaccepted; acceptance requires the exact current sent id/version and active buyer in the same workspace whose id owns the RFQ. Once accepted, a competing resend cannot replace it. Note sale rechecks buyer status/identity and accepted current revision in its committing transaction. Currency for the invoice remains the accepted revision currency; a later factory currency change cannot relabel agreed terms. Recheck configured-currency compatibility when sending a still-unaccepted quotation. Replace the old Task 3 currency guard triggers in migration 0016 with guards using new acceptance/credit-note accounting; unpaid invoice balance still blocks a switch. `quotation_acceptances.created_by` is the authenticated buyer identity (acceptedBy is a display claim, not actor identity); add retained invoice creator/status/updated timestamp columns where absent with additive legacy defaults, populated for new notes without rewriting immutable rows. Buyer/RFQ/revision entities also satisfy Task 1 metadata.

- [ ] **Step 4: Implement**

- Buyer review: role `sales_manager`; `reason()` for `rejected`/`suspended`; on `rejected` also `UPDATE buyer_purchase_orders SET status='cancelled' WHERE buyer_id=? AND status IN ('entered','quoted')`; on `pending → active` one `notifyRole(…,'sales_manager','buyer_rfq.received','buyer_rfq',rfqId,reference)` per held RFQ; audit `buyer.approved` / `buyer.rejected` / `buyer.suspended`.
- Quotes: keys without `currency`; currency from `settingsOf`; pre-check the buyer is `active` (409 above); keep the revision and send logic, minus the outbox inserts.
- `recordAcceptance`: the revision must belong to the active buyer and be `sent` and the current version, enforced inside the batch (409 `'This quotation was replaced. Accept the latest revision.'`); insert the acceptance, move the revision to `approved` (the existing trigger allows `sent → approved`), audit `quotation.accepted` with actor type `buyer`; an identical repeat for the same buyer/revision/version/note returns `already: true`; mismatched replay returns 409 without duplicate audit.
- `noteSale`: refuse without an acceptance (409 above); one batch: `sales_orders` + `sales_order_lines` (as `confirmApprovedRevision` did), `document_counters` upsert for period `karachiDate(now).slice(0,4)`, `invoices` insert whose number is `replace(replace(?, '{YYYY}', ?), '{NNNN}', printf('%04d', (SELECT next_number …)))` with `settings.invoice_format`, the buyer RFQ `confirmed`, audits `sale.noted` and `invoice.issued`. On a UNIQUE clash, retry once.
- `invoiceDocument`: rows for subtotal, `GST (18%)` (from `tax_rate_bp`), total and due date; drop the "Taxes are not shown" note.
- `PENDING_SOURCES`: pending buyers → `sales_manager`; buyer RFQs in state `open` without a sent quotation → `sales_manager`.

- [ ] **Step 5: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0016_sales_portal.sql server/sales.mjs server/buyer-portal.mjs server/cloudflare.mjs server/inventory.mjs server/notify.mjs tests/sales.test.mjs tests/portal-fixture.mjs server/governance.mjs server/admin.mjs tests/thresholds.test.mjs
git rm tests/sales-api.test.mjs
git commit -m "Note sales after buyer acceptance and issue locked invoices with 18% GST, yearly INV numbers and credit notes"
```

### Task 13: Payment tracking and credit alerts

**Files:**
- Create: `drizzle/0017_payments.sql`
- Create: `tests/payments.test.mjs`
- Modify: `server/sales.mjs` (payments route, `paymentStatus`, `creditAlertsScheduled`, overview balances)
- Modify: `server/cloudflare.mjs` (`scheduled` adds `creditAlertsScheduled`)
- Modify: `server/governance.mjs`, `server/admin.mjs` (currency-change eligibility uses invoice payments/credit notes), `tests/thresholds.test.mjs` (paid/unpaid currency-switch regressions).

**Interfaces:**
- Consumes: invoices with `due_at` (Task 12), `settingsOf().credit_alert_days`, `notifyRole`.
- Produces:
  - `paymentStatus({ total_minor, credited_minor, paid_minor, due_at }, now) → 'unpaid' | 'partially_paid' | 'paid' | 'overdue'`: `paid` when `total − credited − paid ≤ 0`; else `overdue` when `now > due_at`; else `partially_paid` when `paid > 0`; else `unpaid`.
  - `POST /api/erp/sales/payments {id, invoiceId, amountMinor, receivedAt, note?}` (role `sales_manager`) → `{ payment, invoice: { …, credited_minor, paid_minor, outstanding_minor, status } }`.
  - `GET /api/erp/sales` invoices gain `credited_minor`, `paid_minor`, `outstanding_minor`, `status`, `days_to_due`, and `alerts`.
  - Alert kinds: `before_<n>` for each configured day count, `due_today`, `overdue`; events `payment.due_soon`, `payment.due_today`, `payment.overdue`.
  - `creditAlertsScheduled(env, now = Date.now()) → Promise<{ checked: number, created: number }>`.

- [ ] **Step 1: Write the failing tests** (`tests/payments.test.mjs`)

Invoice total `14750000`, credit 30 days, issued at `t0`; `due = dueAt(t0, 30)`.

```js
test('partial payments move an invoice from unpaid to partially paid to paid', async () => {
  // status 'unpaid'; pay 5000000 → 'partially_paid'; pay 9750000 → 'paid'; pay 1 → 409 'This payment is more than the amount still owed.'
});
test('an unpaid balance after the due date is overdue', () => {
  assert.equal(paymentStatus({ total_minor: 100, credited_minor: 0, paid_minor: 40, due_at: 1000 }, 1001), 'overdue');
  assert.equal(paymentStatus({ total_minor: 100, credited_minor: 60, paid_minor: 40, due_at: 1000 }, 5000), 'paid');
});
test('credit notes reduce what is owed', async () => { /* credit 750000, pay 14000000 → 'paid' */ });
test('sales managers are alerted 7 and 3 days before, on the due date and when overdue, once each', async () => {
  // creditAlertsScheduled at due − 7 days (Karachi) → created 1 kind 'before_7', Sana has 'payment.due_soon'; same day again → 0
  // at due − 3 days → 'before_3'; on the due date (Karachi) → 'due_today' ('payment.due_today'); at due + 1 day → 'overdue' ('payment.overdue')
  // an invoice first seen 2 days before due gets only 'before_3', not 'before_7'
  // once paid in full, no further alerts
});
test('alert days follow the admin setting', async () => { /* credit_alert_days [10] → at due − 10 days kind 'before_10' */ });
test('only sales managers record payments, and payments cannot be edited', async () => {
  // Danish POST → 403; UPDATE invoice_payments → throws /immutable payment/
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/payments.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Write `drizzle/0017_payments.sql`**

- `invoice_payments(id PK, workspace_id, invoice_id REFERENCES invoices, amount_minor INTEGER NOT NULL CHECK(amount_minor > 0), received_at INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'recorded' CHECK(status='recorded'), created_by, created_at, updated_at)`; trigger `validate_invoice_payment` (`due_at IS NOT NULL` and amount ≤ total − credit notes − earlier payments; message `'payment exceeds balance'`); no-update/no-delete triggers raising `'immutable payment'`.
- `credit_alerts(id PK, workspace_id, invoice_id REFERENCES invoices, kind TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'sent' CHECK(status='sent'), created_by TEXT NOT NULL DEFAULT 'system:credit_alerts', created_at, updated_at, UNIQUE(invoice_id, kind))`.

- [ ] **Step 4: Implement**

Days to due `d` = whole days between `karachiDate(now)` and `karachiDate(due_at)`. For an invoice with a positive balance: `now > due_at` → `overdue`; `d === 0` → `due_today`; otherwise the smallest configured `n` with `d <= n` → `before_<n>`; nothing when `d` exceeds every `n`. Insert the alert and the notification in one batch only when the `(invoice_id, kind)` row does not exist yet. Payment errors containing `payment exceeds balance` map to the 409 above.

Replace the prior currency guard triggers in migration 0017 with guards using invoice total minus credit notes minus invoice_payments (plus any preserved legacy payment accounting). A partially paid invoice blocks PKR→USD with 409; fully paid/credited does not, provided other blockers are absent. Repeat those assertions in `tests/thresholds.test.mjs`. New payments and credit alerts satisfy Task 1 metadata; alert creator is `system:credit_alerts`.

- [ ] **Step 5: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0017_payments.sql server/sales.mjs server/cloudflare.mjs tests/payments.test.mjs server/governance.mjs server/admin.mjs tests/thresholds.test.mjs
git commit -m "Track invoice payments with partial and overdue states and alert the sales manager before and after due dates"
```

### Task 14: Dispatch lifecycle, approval requests, holds and stock issues

**Files:**
- Create: `drizzle/0018_dispatch.sql`
- Create: `server/dispatch.mjs`
- Create: `tests/dispatch.test.mjs`
- Modify: `server/inventory.mjs` (`erp.dispatch`, merge handlers), `server/notify.mjs` (`PENDING_SOURCES`)
- Modify: `src/LiveApp.tsx` (replace immediate dispatch with request/approve/hold/dispatched controls), `tests/inventory-api.test.mjs`, `e2e/inventory.spec.ts` (no immediate deduction path).

**Interfaces:**
- Consumes: sales orders (Task 12), `adjustmentQueries` and `addFinished` (Task 11), `needsApproval`, `approvalQueries`, `notifyRole`.
- Produces:
  - Dispatch statuses: `pending_approval | approved | on_hold | dispatched | delivered`. Hold terms: `payment_overdue | terms_not_met | other`.
  - Routes (`dispatchApi`): `GET /api/erp/dispatch?status=` (viewer `dispatch, sales_manager`); `POST /api/erp/dispatch {id, orderId, lotId, quantityMilli, grams?, cartons?, cones?, vehicle?, transporter?}` (create and request approval); `POST /api/erp/dispatch/request {dispatchId}` (re-request for an `on_hold` dispatch); `POST /api/erp/dispatch/hold {dispatchId, noticeId, reason}`; `POST /api/erp/dispatch/dispatched {dispatchId, vehicle?, transporter?}`; `POST /api/erp/dispatch/delivered {dispatchId, deliveryProof?}`; `POST /api/erp/dispatch/stock-issues {id, dispatchId?, lotId, stage, kind: 'shortage'|'mismatch', differenceGrams, description}` (all role `dispatch`); `POST /api/erp/dispatch/requests/decide {requestId, decision: 'approve'|'hold', term?, reason?}` and `POST /api/erp/dispatch/hold-notices {dispatchId, term, message}` (role `sales_manager`); `POST /api/erp/dispatch/stock-issues/decide {id, decision: 'accept'|'reject', reason?, correctionGrams?}` (role `supervisor`).
  - `approvalHandlers = { dispatch_stock_issue }` (payload `{ correctionGrams, correctionReason, lotId, stage, adjustmentId, gates: { dispatch: {amount,threshold,required}, inventory: {amount,threshold,required} | null } }`). `GET /api/erp/dispatch/stock-issues?status=` (viewer supervisor/admin; scoped workspace) → `{issues:[{id,dispatch_id,lot_id,stage,kind,difference_grams,description,status,decision_reason,correction_grams,adjustment_id,created_at}], thresholds:{dispatchStockIssueGrams:number|null,inventoryAdjustmentGrams:number|null}}`.

- [ ] **Step 1: Write the failing tests** (`tests/dispatch.test.mjs`)

Setup: finished lot of 10 kg (`addFinished({ grams: 10000 })`), a noted sale of 5 kg on that product.

```js
test('dispatch asks for approval; the sales manager approves and dispatch is told', async () => {
  // Danish POST → 201 status 'pending_approval'; Sana has 'dispatch.approval_requested'
  // decide approve → status 'approved'; Danish has 'dispatch.approved'; audit 'dispatch.approved'
});
test('the sales manager holds with a term and a reason', async () => {
  // decide hold without reason → 422; term 'weather' → 422
  // {term:'payment_overdue', reason:'Invoice INV-2026-0001 is overdue'} → 'on_hold', hold_reason stored, Danish has 'dispatch.held', audit 'dispatch.held'
  // POST /erp/dispatch/request → back to 'pending_approval'
});
test('dispatch holds an approved dispatch only after a sales-manager message', async () => {
  // hold without a notice → 409 'A hold needs a message from the sales manager.'
  // Sana hold-notice {term:'terms_not_met', message:'Buyer has not signed the revised terms'} → Danish has 'dispatch.hold_notice'
  // Danish hold {noticeId, reason:'Holding on the sales manager message'} → 'on_hold', notice 'acknowledged'
});
test('inventory is deducted only when the status becomes dispatched', async () => {
  // approved: finished grams 10000; dispatched → 5000, movement action 'dispatch', sales order 'dispatched'
  // a pending_approval dispatch → dispatched → 409 'Only an approved dispatch can leave the factory.'
});
test('short stock never dispatches and the status stays approved', async () => {
  // lot with 3000 g, order line 5 kg → dispatched → 409 'Stock is short or does not match. Raise a stock issue to the supervisor.'; status 'approved', grams 3000
});
test('stock issues go to the supervisor; at or above the threshold the correction waits for admin', async () => {
  // Danish raises shortage 2000 g → supervisors have 'stock_issue.raised'
  // setThreshold('dispatch_stock_issue', 1000); Saima accept {correctionGrams:-2000,reason:'Verified shortage after recount'} → issue 'pending_approval', grams unchanged
  // admin approves → grams lower by 2000, inventory_adjustments row source 'stock_issue' applied
  // another issue: reject without reason → 422, with reason → 'rejected'
});
test('dispatch cannot decide its own requests', async () => { /* Danish POST requests/decide → 403 */ });
test('vehicle, transport and delivery proof are optional', async () => {
  // dispatched without vehicle → 200; delivered {deliveryProof:'Signed DC #4411'} → 'delivered', delivery_proof stored
});
```

Add `test('stock issue approval gates apply with and without corrections')`: difference=2000, dispatch threshold=1000, no correction→202 and zero stock effect until approval; difference=100, dispatch threshold=1000, correction=-2000, inventory threshold=1000→202; both thresholds=1000 and difference/correction=2000→one approval and one adjustment only; exact thresholds gate. Missing correction reason→422. Concurrent approval→[200,409] and one delta. Add `test('supervisors read the scoped stock issue queue')`: supervisor/admin→200 with shape above; sales/dispatch→403, foreign rows absent. Add `test('raw and legacy stages cannot sale-dispatch')`: raw/cops/WIP attempts→422, balances and dispatch count unchanged; finished succeeds after approval. Assert old immediate dispatch returns 410 with no movement.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/dispatch.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Write `drizzle/0018_dispatch.sql`**

- `dispatches(id PK, workspace_id, sales_order_id REFERENCES sales_orders, lot_id REFERENCES lots, quantity_milli INTEGER NOT NULL CHECK(quantity_milli > 0), grams INTEGER NOT NULL CHECK(grams > 0), cartons INTEGER NOT NULL DEFAULT 0, cones INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL CHECK(status IN ('pending_approval','approved','on_hold','dispatched','delivered')), hold_reason TEXT, vehicle TEXT NOT NULL DEFAULT '', transporter TEXT NOT NULL DEFAULT '', delivery_proof TEXT NOT NULL DEFAULT '', sales_dispatch_id TEXT REFERENCES sales_dispatches(id), version INTEGER NOT NULL DEFAULT 1, created_by, created_at, updated_at, dispatched_at, delivered_at, CHECK(status != 'on_hold' OR length(trim(COALESCE(hold_reason,''))) >= 5))`; trigger `dispatch_status_flow` allowing only `pending_approval→approved|on_hold`, `approved→on_hold|dispatched`, `on_hold→pending_approval`, `dispatched→delivered`.
- `dispatch_requests(id PK, workspace_id, dispatch_id REFERENCES dispatches, kind TEXT NOT NULL CHECK(kind IN ('approval','hold_notice')), status TEXT NOT NULL CHECK(status IN ('pending','approved','held','acknowledged')), term TEXT CHECK(term IS NULL OR term IN ('payment_overdue','terms_not_met','other')), message TEXT NOT NULL DEFAULT '', reason TEXT, requested_by, created_by, decided_by, created_at, updated_at, decided_at)`; `CREATE UNIQUE INDEX dispatch_one_pending ON dispatch_requests(dispatch_id, kind) WHERE status='pending'`.
- `stock_issues(id PK, workspace_id, dispatch_id REFERENCES dispatches, lot_id REFERENCES lots, stage TEXT NOT NULL CHECK(stage IN ('raw','finished')), kind TEXT NOT NULL CHECK(kind IN ('shortage','mismatch')), difference_grams INTEGER NOT NULL CHECK(difference_grams >= 0), description TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('open','pending_approval','accepted','rejected')), decision_reason TEXT, correction_grams INTEGER, adjustment_id TEXT REFERENCES inventory_adjustments(id), created_by, created_at, updated_at, decided_by, decided_at)`.

- [ ] **Step 4: Implement**

- "Dispatched": one batch using Task 10 `movementQueries` (`dispatch`, finished stage) plus `sales_dispatches` inserts and the `sales_orders` status update, copied from the removed `/api/erp/sales/dispatches` route (Task 12 deleted it; recover it with `git show 4212ef5:yarn-erp/server/sales.mjs`, lines 287-328), with `carrier = transporter || 'Factory transport'`, then `dispatches.status='dispatched'`, `sales_dispatch_id`, `dispatched_at`. Any trigger failure maps to the 409 above.
- Requests decide: `approve` sets request `approved` and dispatch `approved`; `hold` needs `term` and `reason()`, sets request `held`, dispatch `on_hold` with `hold_reason`. Audit `dispatch.approved` / `dispatch.held`. Dispatch's own hold needs a `pending` `hold_notice` for that dispatch and `reason()`; it sets the notice `acknowledged`.
- Stock issue accept independently checks dispatch_stock_issue against `difference_grams` even with no correction, and inventory_adjustment against `abs(correctionGrams)` when non-zero. A correction requires `reason()` and a validated raw/finished stage; pass it to the required adjustment reason field. If either gate requires approval, raise one `dispatch_stock_issue` request with both request-time gate snapshots, and leave issue/adjustment pending without stock effects. `approval_requests.amount/threshold` summarize the dispatch gate when required, otherwise the inventory gate; complete gates remain in immutable payload and `describe`. One admin approval satisfies both gates in one batch, guards the issue transition, calls `adjustmentQueries` once if needed and sets accepted; rejection marks both issue and unapplied adjustment rejected. With neither gate required, the same effect builder applies immediately. Reject always requires reason. Audit `stock_issue.accepted` / `stock_issue.rejected`; do not raise a second independent adjustment approval.
- `PENDING_SOURCES`: pending approval requests → `sales_manager`; open stock issues → `supervisor`; pending hold notices → `dispatch`.

Close the final legacy immediate dispatch bypass in `/api/movements` and any alternate inventory dispatch writer with 410; LiveApp's current dispatch control uses the new request→sales approval→dispatched flow with hold/reason/intervention fields. Keep stock read visibility; new sale dispatch accepts only finished stock. Raw stock returns 422 `'Raw stock cannot be sale-dispatched; only finished goods are supported.'`; cops/WIP return the Task 11 read-only migration explanation, before any movement or request is written. Retained legacy stock cannot be silently converted. `dispatch_stock_issue.describe` includes both gates, evidence and correction reason. New entities carry all metadata; dispatch request created_by equals requested_by. Admin corrections to decided issues use a new inventory adjustment through `/erp/stock/adjustments` linked by compensatesId to the original issue, with reason/intervention and normal thresholds; original history remains immutable.

- [ ] **Step 5: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

Also run: `npx playwright test --project=desktop-chromium`; expected the adapted dispatch controls pass.

- [ ] **Step 6: Commit**

```bash
git add drizzle/0018_dispatch.sql server/dispatch.mjs server/inventory.mjs server/notify.mjs tests/dispatch.test.mjs src/LiveApp.tsx tests/inventory-api.test.mjs e2e/inventory.spec.ts
git commit -m "Add dispatch approval, holds and stock issues, deducting stock only when goods leave"
```

### Task 15: Integration API for the supplier and buyer portals

The live supplier portal screen keeps working until Task 22 removes it; this task adds the token API beside it and moves the shared bid logic so both use it.

**Files:**
- Create: `server/integration.mjs`
- Create: `tests/integration.test.mjs`
- Modify: `server/procurement.mjs` (extract `submitBid` from `supplierOperations`), `server/inventory.mjs` (route `/api/integration/v1/*` before the Origin check), `scripts/dev-server.mjs` (pass `SUPPLIER_PORTAL_TOKEN`, `BUYER_PORTAL_TOKEN` from `process.env`)
- Modify: `server/sales.mjs` (export/reuse `buyerData`, `invoiceFileResponse` and acceptance actor contract).

**Interfaces:**
- Consumes: `supplierData`, `categoryIds`, `categoryQueries` (procurement), `buyerData`, `recordAcceptance`, `invoiceFileResponse`, `paymentStatus` (sales), `settingsOf`, `notifyRole`, `audit`.
- Produces:
  - Auth: `Authorization: Bearer <token>`; supplier routes need Worker secret `SUPPLIER_PORTAL_TOKEN`, buyer routes `BUYER_PORTAL_TOKEN` (each ≥ 32 chars); unset → 503 `'The <supplier|buyer> portal connection is not configured.'`; wrong or missing → 401. Compared in constant time. The factory workspace is the single workspace (503 when there are several, as today).
  - `submitBid(db, supplier: { id, workspace_id, status }, actor: { user_id, workspace_id, role: 'supplier' }, data, now) → Promise<{ bid, created: boolean }>` (moved logic; the currency must equal `settingsOf().currency`, else 422 `` `Bid in ${currency}.` `` (`'Bid in PKR.'` by default); notifies `bid.received`).
  - Supplier routes: `POST /api/integration/v1/suppliers {id, company, contactName, email, phone, city?, website?, categories}`; `GET /api/integration/v1/suppliers/<id>`; `GET /api/integration/v1/suppliers/<id>/rfqs`; `POST /api/integration/v1/bids {id, supplierId, rfqId, version, quantityMilli, priceMinor, currency, paymentTerms, deliveryAt, validUntil, note?}`; `GET /api/integration/v1/suppliers/<id>/bid-results` → `{ results: [{ bidId, rfqId, status: 'submitted'|'rejected'|'pending_award'|'awarded'|'not_awarded', rejectionReason, purchaseOrder: { reference, quantityMilli, totalMinor } | null }] }`.
  - Buyer routes: `POST /api/integration/v1/buyers {id, company, contactName, email, phone, city?}`; `GET /api/integration/v1/buyers/<id>`; `POST /api/integration/v1/buyer-rfqs {id, buyerId, reference, specifications, quantityMilli, unit, requestedDeliveryAt, paymentTerms}` → `{ rfq: { id, state } }`; `GET /api/integration/v1/buyers/<id>/quotations`; `POST /api/integration/v1/acceptances {buyerId, quotationId, version, acceptedBy, note?}`; `GET /api/integration/v1/buyers/<id>/invoices`; `GET /api/integration/v1/buyers/<id>/invoices/<invoiceId>` (HTML).
  - Registrations and buyer RFQs use their existing `id` + `request_hash` idempotency. Bids reuse immutable version/snapshot history (no new hash column/migration); acceptances use the buyer/revision/version and identical-body contract from Task 12. Intake audits have actor type/role `supplier` or `buyer` and the authenticated external identity id, never a missing staff user id.

- [ ] **Step 1: Write the failing tests** (`tests/integration.test.mjs`)

Env: `SUPPLIER_PORTAL_TOKEN = 's'.repeat(40)`, `BUYER_PORTAL_TOKEN = 'b'.repeat(40)`.

```js
test('intake needs its own portal token', async () => {
  // no header → 401; buyer token on /suppliers → 401; env without SUPPLIER_PORTAL_TOKEN → 503
});
test('a supplier registration arrives pending and tells purchase managers', async () => {
  // POST → 201 {supplier:{id, status:'pending'}}; Pervaiz has 'supplier.pending'; same id and body → 200; same id, other email → 409
});
test('only approved suppliers bid, in the factory currency, before the deadline', async () => {
  // pending supplier → 403; currency 'USD' → 422; after deadline → 409; valid → 201 and Pervaiz has 'bid.received'
});
test('bids are sealed: each supplier reads only its own bid results', async () => {
  // suppliers A and B bid 125000 and 119000; A's bid-results text contains A's bid id and not B's id or '119000'
});
test('purchase RFQs reach only approved suppliers in the category', async () => { /* cotton A sees the RFQ; synthetic C gets [] */ });
test('RFQs from pending buyers are held; the sales manager hears once the buyer is approved', async () => {
  // pending buyer RFQ → state 'awaiting_buyer_approval', Sana has no 'buyer_rfq.received'; approve buyer → Sana has it
  // rejected buyer POST buyer-rfqs → 403
});
test('a buyer accepts only the latest sent quotation, once', async () => {
  // accept → 201; repeat → 200 {already:true}; an older version → 409
});
test('quotations and invoices go out only to their own buyer', async () => {
  // buyer B's /invoices → []; A's invoice document → 200, content-type text/html, body contains 'INV-'
});
test('server-to-server calls need no Origin header', async () => { /* POST /suppliers without Origin → 201 */ });
```

Add `test('bid replay and actor attribution are explicit across both transports')`: integration create version=0→201, exact retry→200, conflicting retry→409; history/audit actor_id=supplier.id and actor_role/type=supplier; exactly one `bid.received` per PM. Legacy portal create uses its supplier-user id and one notification; concurrent identical retries create one revision. Buyer acceptance audit and quotation_acceptances.created_by equal buyer identity, not caller-provided acceptedBy. Verify wrong supplier/workspace replay cannot read a bid.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/integration.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `integration.mjs` and `submitBid`**

`submitBid` moves the existing `/api/portal/bids` body, including the single Task 7 notification, and adds the currency check; `supplierOperations` delegates with no extra audit/notification. Integration actor is `{user_id:supplier.id,workspace_id:supplier.workspace_id,role:'supplier'}`; the legacy portal passes its authenticated supplier-user id and the same workspace/type. Bid history actor_id and audit actor_id come from that explicit actor. Buyer intake/acceptance analogously uses buyer.id as actor_id (portal requests may retain their authenticated buyer-user identity); acceptedBy remains display text. Buyer RFQ intake reuses the `/api/buyer/pos` validation; it accepts `pending` and `active` buyers, refuses others with 403, and notifies `sales_manager` `buyer_rfq.received` only for `active` buyers. Supplier and buyer registration notify `supplier.pending` / `buyer.pending`. Bid result `status`: `rejected` from the bid; `awarded` when a PO references the bid; `pending_award` while a pending `purchase_award` approval names it; `not_awarded` when the RFQ is awarded to another bid or cancelled; else `submitted`.

Bid idempotency: preserve the existing expected-version contract (`version:0` creates revision 1). Normalize the bid terms and compare to the immutable `supplier_bid_history.snapshot` for the resulting version: identical retry returns `{created:false}` and 200 without any history/audit/notification; different terms with the same expected version return 409. An intentional revision supplies the current expected version and creates exactly one next snapshot, audit and `bid.received`. Check supplier/RFQ/workspace ownership on every retry; concurrent identical submissions converge to one committed revision. Currency compatibility is checked transactionally with Task 3's currency-change guard. Export the sales validators/document helper used by integration, leaving their authorization at the calling boundary.

- [ ] **Step 4: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add server/integration.mjs server/procurement.mjs server/inventory.mjs scripts/dev-server.mjs tests/integration.test.mjs server/sales.mjs
git commit -m "Add token-authenticated integration endpoints for the separate supplier and buyer portals"
```

### Task 16: Analytics for admin, sales and purchasing

**Files:**
- Create: `server/analytics.mjs`
- Create: `tests/analytics.test.mjs`
- Modify: `server/inventory.mjs` (`erp.analytics`)

**Interfaces:**
- Consumes: tables from Tasks 6–14, `paymentStatus`, `supplierPerformance`.
- Produces:
  - `GET /api/erp/analytics/admin?from=&to=` (admin) → `{ purchasing: { rfqs: Record<status, number>, awards, totalsByCurrency: [{currency,poTotalMinor}] }, quality: { inspectedMilli, acceptedMilli, rejectedMilli, passRate, claims: Record<outcome, number>, totalsByCurrency: [{currency,claimMinor}] }, inventory: { rawGrams, copsGrams, wipGrams, finishedGrams, adjustments, adjustedGrams }, sales: <sales block>, payments: { byCurrency: [{currency,outstandingMinor,overdueMinor}] }, dispatch: Record<status, number>, users: [{ name, role, actions }] }`.
  - `GET /api/erp/analytics/sales?from=&to=` (viewer `sales_manager`) → `{ byPeriod: [{ period: 'YYYY-MM', currency, totalMinor }], byBuyer: [{ buyer, currency, totalMinor }], byProduct: [{ product, currency, totalMinor }], paymentStatus: { unpaid, partially_paid, paid, overdue }, overdueByCurrency: [{currency,overdueMinor}] }`.
  - `GET /api/erp/analytics/purchase?from=&to=` (viewer `purchase_manager`) → `{ suppliers: [{ id, name, ...supplierPerformance }], bidding: { rfqs, bids, averageBidsPerRfq, awarded, cancelled } }`.
  - Periods are Karachi calendar months: `strftime('%Y-%m', (issued_at + 18000000) / 1000, 'unixepoch')`.

- [ ] **Step 1: Write the failing tests** (`tests/analytics.test.mjs`)

```js
test('sales analytics group by Karachi month, buyer and product, with payment status and overdue amount', async () => {
  // invoice issued Date.UTC(2026,9,31,20,0) (1 Nov 01:00 PKT) → period '2026-11'; two buyers → byBuyer sums exact;
  // one overdue invoice of 14750000 → overdueByCurrency [{currency:'PKR',overdueMinor:14750000}], paymentStatus.overdue 1
});
test('purchase analytics give supplier performance and a bidding summary', async () => {
  // 2 RFQs, 3 bids, 1 awarded → averageBidsPerRfq 1.5, awarded 1; supplier qcPassRate 0.8
});
test('admin analytics cover every module and user activity', async () => {
  // users[] counts audit rows per actor in range; inventory.finishedGrams equals SUM of finished balances
});
test('each role sees only its analytics', async () => {
  // purchase manager GET sales → 403; sales manager GET admin → 403; inspector GET purchase → 403; admin GET all three → 200
});
```

Add `test('analytics never sum unlike currencies')`: historical PKR invoice total=14750000 and USD invoice total=20000 produce separate labelled groups for period, buyer, product, outstanding/overdue and admin totals; no scalar 14770000. PO and claim totals likewise stay in their source currency after a settings change.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/analytics.test.mjs`
Expected: FAIL.

- [ ] **Step 3: Implement `analytics.mjs`**

Plain aggregate SQL per block; sales totals use invoice `total_minor` minus credit notes; the sales block of the admin endpoint is the same function the sales endpoint returns.

Every monetary SUM groups by the source record's immutable currency (PO/claim terms or invoice), including payment/outstanding/overdue, buyer/product/month and admin totals. Never expose a combined unlike-currency total; counts may combine. QC aggregates reuse Task 10 final lot disposition semantics, not repeated inspection totals. Inventory summaries preserve legacy cops/WIP visibility alongside raw/finished.

- [ ] **Step 4: Run all tests**

Run: `npm test && npx tsc -b`
Expected: `fail 0`; tsc silent.

- [ ] **Step 5: Commit**

```bash
git add server/analytics.mjs server/inventory.mjs tests/analytics.test.mjs
git commit -m "Add admin, sales and purchasing analytics endpoints"
```

### Task 17: Role-driven shell, Notifications and My profile

**Files:**
- Create: `src/roles.ts`, `src/PortalCommon.tsx`, `src/Notifications.tsx`, `src/Profile.tsx`
- Create: `e2e/roles.spec.ts`
- Modify: `src/LiveApp.tsx` (navigation from `NAV`, hash routes `#/<section>/<tab>/<id>`, Settings content moves to My profile)
- Modify: `scripts/dev-server.mjs` (test mode seeds one user per role), `playwright.config.ts` (portal tokens in the web server command)
- Modify: `e2e/helpers.ts` (`signIn` waits for the `Dashboard` heading), and the tab-label expectations in `e2e/every-button.spec.ts`, `e2e/interaction-foundation.spec.ts`, `e2e/language-layout.spec.ts`, `e2e/session-lifecycle.spec.ts`, `e2e/inventory.spec.ts`
- Modify: `src/Procurement.tsx` (replace its Task 7 local intervention field with the shared `PortalCommon.InterventionField`).

**Interfaces:**
- Consumes: `Member.role`, `roleLabel` (Task 1), `/api/erp/notifications*` (Task 5).
- Produces:
  - `src/roles.ts`: `interface Section { id: string; en: string; ur: string; icon: LucideIcon; tabs?: { id: string; en: string; ur: string }[] }`; `NAV: Record<Role, Section[]>` (role sections, grown by Tasks 18–21); `COMMON: Section[]` = `notifications` (Notifications / اطلاعات, Bell, unread badge), `profile` (My profile / میری پروفائل, CircleUserRound), `scanner` (Scan), `help` (Help); `eventTitle: Record<string, [string, string]>` for every event in Task 5; `objectRoute(objectType: string, objectId: string, context: {role: Role, module?: Role, installedModules: Role[]}) → string` (hash); resolves an accessible role section or admin module route and otherwise `#/notifications`, never an inaccessible section that falls back to dashboard.
  - Target navigation (each row's owner task adds it; spec §8 item numbers in brackets). Sub-screens are segmented tabs inside a section, so no sidebar exceeds 8 role items:

| Role | Section id: tabs | Spec | Task |
|---|---|---|---|
| admin | `dashboard`; `approvals` (+`#/approvals/<id>`); `claims` (+`#/claims/<id>`); `activity`: `monitor`, `audit`; `reports`; `analytics`; `settings`: `thresholds`, `invoices`, `users`; `modules`: `purchase`, `quality`, `supervisor`, `sales`, `dispatch` | 8.1.1–8.1.11 | 18 (modules filled by 19–21) |
| purchase_manager | `dashboard`; `suppliers`: `all`, `pending` (+`#/suppliers/<id>` profile with Rate); `rfqs`: `list`, `new`, `awards` (+`#/rfqs/<id>` detail with start/end bidding and bid comparison); `orders`: `list`, `tracking` (+`#/orders/<id>`); `claims`; `analytics` | 8.2.1–8.2.13 | 19 |
| sales_manager | `dashboard`; `buyers`: `all`, `pending` (+`#/buyers/<id>`); `buyer-rfqs` (+`#/buyer-rfqs/<id>`: stock query, quotation, note sale); `invoices`: `invoices`, `payments`, `alerts` (+`#/invoices/<id>`); `dispatch-requests`; `analytics` | 8.5.1–8.5.12 | 20 |
| dispatch | `dashboard`; `dispatches`: `pending_approval`, `approved`, `on_hold`, `dispatched` (+`#/dispatches/<id>` detail, tracking, hold, stock issue); `new`; `history` | 8.6.1–8.6.7 | 20 |
| quality_inspector | `dashboard`; `lots` (+`#/lots/<id>`: inspection form, photos, issue form); `submissions`: `mine`, `returned` | 8.3.1–8.3.7 | 21 |
| supervisor | `dashboard`; `reviews`: `reports`, `issues`; `inventory`: `list`, `add`, `adjust` (+`#/inventory/<lotId>`); `requests`: `queries`, `stock-issues`; `report`; `history` | 8.4.1–8.4.10 | 21 |

  - Until its owner task lands, a role keeps the legacy screen its users had: admin `Stock`, `History`, `Procurement`, `Team`; purchase_manager `Procurement`; supervisor, quality_inspector and dispatch `Stock` and `History`. The initial `NAV` lists exactly those plus `dashboard`.
  - `src/PortalCommon.tsx`: `ReasonField({ label, value, onChange, required = true })` (textarea, `minLength 5`, `maxLength 1000`); `InterventionField({ member, owners: Role[], value, onChange })` (renders a required `ReasonField` labelled `t('Intervention reason', 'مداخلت کی وجہ')` only when `member.role === 'admin' && !owners.includes('admin')`); `StatusTag({ status })` (tint + word + icon; `ok` for approved/accepted/paid/delivered/settled, `warn` for pending states, `bad` for rejected/held/overdue/on_hold, stone otherwise); `NextStep({ tone, title, reason, action })` (the next-step field extracted from `src/WorkspaceDashboard.tsx`); `SectionTabs({ tabs, value, onChange })` (a `.live-segments` control); `useResource<T>(path) → { data: T | null, error: string, loading: boolean, reload(): Promise<void> }`; `portal<T>(path, data?) → Promise<T>` = `inventoryRequest('/erp' + path, data)`; `money(minor, currency = 'PKR')`; `kg(grams)`.
  - Every role's `dashboard` in this task: a `NextStep` naming the oldest unread notification (or an all-clear `ok` field) and the five newest notifications. Tasks 18–21 replace it per role.
  - Dev server test mode seeds `Pervaiz` (purchase_manager), `Qasim` (quality_inspector), `Saima` (supervisor), `Sana` (sales_manager), `Danish` (dispatch), PIN `2468`; Playwright's web server command adds `SUPPLIER_PORTAL_TOKEN=e2e-supplier-portal-token-000000000000 BUYER_PORTAL_TOKEN=e2e-buyer-portal-token-00000000000000000`.

- [ ] **Step 1: Write the failing e2e spec** (`e2e/roles.spec.ts`)

```ts
for (const [name, sections] of [
  ['Anas', ['Dashboard', 'Stock', 'History', 'Procurement', 'Team']],
  ['Pervaiz', ['Dashboard', 'Procurement']],
  ['Saima', ['Dashboard', 'Stock', 'History']],
  ['Sana', ['Dashboard']],
  ['Qasim', ['Dashboard', 'Stock', 'History']],
  ['Danish', ['Dashboard', 'Stock', 'History']],
] as const) test(`${name} sees only the sections of their role, plus the common ones`, async ({ page }) => {
  await signIn(page, name);
  const nav = page.getByRole('navigation', { name: 'Main navigation' });
  for (const label of [...sections, 'Notifications', 'My profile', 'Scan', 'Help']) await expect(nav.getByRole('button', { name: new RegExp(`^${label}`) })).toBeVisible();
  await expect(nav.getByRole('button')).toHaveCount(sections.length + 4);
});
test('a notification appears with its unread count and opens its item', async ({ page }) => {
  // POST /api/integration/v1/suppliers with the e2e supplier token creates a pending supplier
  // sign in as Pervaiz: the Notifications badge shows 1; the row 'New supplier pending' opens #/notifications (suppliers screen not built yet) and marks it read; the badge disappears
});
test('My profile shows the role and switches language', async ({ page }) => {
  // Pervaiz → My profile shows 'Purchase Manager'; switching to اردو sets <html dir="rtl"> and the heading 'میری پروفائل'
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test e2e/roles.spec.ts --project=desktop-chromium`
Expected: FAIL (no `Dashboard` heading).

Define admin module hashes as `#/modules/<module>/<section>/<tab>/<id>`; role routes remain `#/<section>/<tab>/<id>` with optional segments parsed explicitly. `objectRoute` maps supplier/rfq/bid/purchase_order/shipment→purchase, qc_lot/qc_inspection→quality or supervisor review as appropriate, stock_query/stock_issue/inventory_adjustment→supervisor, buyer/buyer_rfq/quotation/invoice→sales, dispatch→dispatch (sales request destination for sales_manager); approval/claim/supervisor_report use admin approvals/claims/reports; user→admin settings/users, threshold→settings/thresholds, setting→settings/invoices. Payment/credit-note events resolve their invoice destination; a destination screen may resolve related ids using its authorized read API. Bid and shipment detail may resolve their parent RFQ/PO via the owning screen. Admin links select the installed module and preserve object id; module renderers keep the actual admin member for intervention checks. Unbuilt modules return notifications until their owner task installs them. All notifications/audit links supply this context. Consolidate Task 7's intervention field into PortalCommon and update its import.

- [ ] **Step 3: Implement the shell**

`LiveApp.tsx` builds the sidebar, phone bottom nav (first three role sections, Notifications, More) and menu sheet from `[...NAV[me.role], ...COMMON]`; Scan and Help sit at the sidebar foot as today. The unread count comes from `/erp/notifications` on the same 10-second refresh as the workspace. A hash for a section the role lacks falls back to `dashboard`. Keep the glide measurement, skip link, offline and save banners. `Profile.tsx` holds what Settings held (language, role, admin backup and InvenTree check). All new copy is bilingual.

- [ ] **Step 4: Run e2e, unit tests and the type check**

Run: `npx tsc -b && npm test && npx playwright test --project=desktop-chromium`
Expected: tsc silent; `fail 0`; Playwright `passed`, none failed.

- [ ] **Step 5: Commit**

```bash
git add src/roles.ts src/PortalCommon.tsx src/Notifications.tsx src/Profile.tsx src/LiveApp.tsx scripts/dev-server.mjs playwright.config.ts e2e src/Procurement.tsx
git commit -m "Drive navigation from the signed-in role and add Notifications and My profile"
```

### Task 18: Admin screens

**Files:**
- Create: `src/AdminScreens.tsx`, `e2e/admin.spec.ts`
- Modify: `src/roles.ts` (admin `NAV`), `src/LiveApp.tsx` (mount), `src/erp.css` (only classes the new screens need)
- Delete: `src/Team.tsx` (its people list moves to `settings › users`; e2e references to `Team` move to `Settings`)
- Create: `src/ModuleViews.tsx` (sole owner of `MODULES`, role-component imports and shared module props).
- Modify: `src/Profile.tsx` (remove Team imports), `e2e/roles.spec.ts`, `e2e/every-button.spec.ts`, `e2e/inventory.spec.ts` (admin NAV/users expectations).

**Interfaces:**
- Consumes: `/erp/approvals*`, `/erp/qc/claims*`, `/erp/admin/{users,thresholds,settings,audit}`, `/erp/stock/reports`, `/erp/analytics/admin`, `PortalCommon`.
- Produces: `AdminScreens({ member, section, tab, id, navigate })`; `src/ModuleViews.tsx` exports `MODULES: Partial<Record<Role, (props: ModuleProps) => JSX.Element>>` with explicit screen imports added by Tasks 19–21, rendered under `modules` with the acting member (so `InterventionField` appears on every action).

- [ ] **Step 1: Write the failing e2e spec** (`e2e/admin.spec.ts`)

```ts
test('the admin sets a threshold and sees who changed it, from what, to what', async ({ page }) => {
  // Settings › Thresholds: Purchase threshold (PKR) 100000 → Save; history row shows 'Anas', '—', 'PKR 100,000.00'; change to 150000 → row 'PKR 100,000.00 → PKR 150,000.00'
});
test('a pending award is approved from the queue; rejecting needs a reason', async ({ page }) => {
  // the admin sets the purchase threshold to PKR 100,000 (10000000); then via API: supplier (integration), Pervaiz's RFQ, a 125000-per-kg bid for 100 kg, award → 202
  // Approvals shows 'Purchase award' with amount 'PKR 125,000.00' and threshold 'PKR 100,000.00'
  // Reject without a reason: the form shows the field error and nothing changes; Approve → item leaves the queue; Pervaiz gets a notification
});
test('the dashboard flags unset thresholds and counts pending approvals', async ({ page }) => { /* 'Thresholds not set' lists the four names */ });
test('the audit log shows old and new values and the activity monitor opens the item', async ({ page }) => { /* filter Object 'user' → role change row 'Dispatch → Supervisor' */ });
test('users: add a person with a role, deactivate and reactivate them', async ({ page }) => { /* replaces the Team test from Task 1 */ });
```

Add `test('admin activity links open the correct module item with admin authority')`: once a module is installed, objectRoute opens its detail and required Intervention reason is visible; uninstalled targets remain in Notifications. Add `test('currency labels follow settings and active records block a switch')`: clean factory PKR→USD shows Purchase threshold (USD); with an open bid a change returns/display 409, retaining the old label. Check Profile renders role after Team removal.

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test e2e/admin.spec.ts --project=desktop-chromium`
Expected: FAIL.

- [ ] **Step 3: Implement the admin sections**

- `dashboard` (8.1.1): `NextStep` for the oldest pending approval (warn) or all clear (ok); pending counts by approval group; "Thresholds not set" list when any `thresholdOf` is null; key figures from `/erp/analytics/admin` as a plain fact list, not tiles.
- `approvals` (8.1.2–8.1.3): `SectionTabs` filter by group (Purchase awards = `purchase_award`+`po_change`, Inventory adjustments, Claims, Dispatch stock issues, Escalations); rows show requester, amount with unit, age; detail `#/approvals/<id>` shows `describe()` output, threshold at request time, Approve and Reject (`ReasonField` required for Reject).
- `claims` (8.1.4): list with status tags; detail shows rejected qty, PO rate, calculated amount, outcome choice (Return / Replacement / Claim), optional adjusted amount that makes `ReasonField` required when it differs.
- `settings › thresholds` (8.1.5): four inputs (Purchase and Claim labelled with `settings.currency`, Inventory adjustment and Dispatch stock issue in kg), each with its history list; `settings › invoices`: currency, GST %, number format, reminder hours, alert days; `settings › users` (8.1.10): add, role select, PIN reset, deactivate/reactivate.
- `activity › monitor` (8.1.6): newest audit rows on a day-grouped thread; each row links to its item via `objectRoute`, where the admin acts with `InterventionField`. `activity › audit` (8.1.7): filters (person, action, object, dates), old → new values, reason and intervention reason, "Load older" paging.
- `reports` (8.1.8): supervisor reports list and detail (sections and flagged items). `analytics` (8.1.9): tables per module from `/erp/analytics/admin`.
- `modules` (8.1.11): `SectionTabs` over the five roles rendering `MODULES[role]`; until a role's task lands its tab shows that role's legacy screen.

Before deleting Team, move `accessSummary(role,language)` to `src/roles.ts` and have Profile/LiveApp import it there. Remove `permissionInfo` display/imports in favor of roleLabel; retain no Team dependency. `AdminScreens` imports MODULES from ModuleViews; roles.ts owns navigation/helpers only and never imports screen implementations. ModuleViews declares `ModuleProps={member,section,tab,id,navigate}`; register only installed screens, render the adapted legacy screen for uninstalled role modules. Update `e2e/roles.spec.ts` admin expected sections to Dashboard, Approvals, Claims, Activity, Reports, Analytics, Settings, Modules (+ common four), replacing Stock/History/Procurement/Team now. User-management tests navigate Settings › Users. Monetary settings/history labels use their recorded currency, not hard-coded PKR; analytics render separate currency groups.

- [ ] **Step 4: Run e2e, unit tests and the type check**

Run: `npx tsc -b && npm test && npx playwright test --project=desktop-chromium`
Expected: tsc silent; `fail 0`; Playwright `passed`, none failed.

- [ ] **Step 5: Commit**

```bash
git add src/AdminScreens.tsx src/roles.ts src/LiveApp.tsx src/erp.css e2e src/ModuleViews.tsx src/Profile.tsx
git rm src/Team.tsx
git commit -m "Add the admin dashboard, approvals queue, claims, thresholds, activity, audit, reports, analytics and users screens"
```

### Task 19: Purchase Manager screens

**Files:**
- Create: `src/PurchaseScreens.tsx`, `e2e/purchase.spec.ts`
- Modify: `src/roles.ts` (purchase_manager `NAV`), `src/ModuleViews.tsx` (import/register `PurchaseScreens` as `MODULES.purchase_manager`), `src/LiveApp.tsx`, `src/ErpCommon.tsx` (keep `CategoryPicker`, `RfqSummary`, `BidTerms`)
- Delete: `src/Procurement.tsx`, `src/IncomingStock.tsx`, `server/receiving.mjs`; remove its routing in `server/inventory.mjs` and the three receipt tests in `tests/procurement-api.test.mjs:132-176`
- Modify: `e2e/procurement.spec.ts` (its staff half uses the new screens; the supplier-portal half stays until Task 22)
- Modify: `server/inventory.mjs`, `tests/procurement-api.test.mjs` (final receipt-route removal), `e2e/roles.spec.ts` (purchase NAV and notification links).

**Interfaces:**
- Consumes: `/erp/suppliers*`, `/erp/rfqs*`, `/erp/bids/*`, `/erp/procurement`, `/erp/orders/quantity`, `/erp/orders/pending-approvals`, `/erp/shipments*`, `/erp/qc/lots` (PM registers arrivals), `/erp/qc/claims`, `/erp/analytics/purchase`.
- Produces: `PurchaseScreens({ member, section, tab, id, navigate })`.

- [ ] **Step 1: Write the failing e2e spec** (`e2e/purchase.spec.ts`)

```ts
test('a registered supplier is approved and an RFQ runs from bidding to PO', async ({ page, request }) => {
  // supplier via POST /api/integration/v1/suppliers with the e2e supplier token; Pervaiz: Suppliers › Pending → Approve
  // RFQs › New (item 'Cotton combed 30/1', 100 kg, Pure Cotton, dates) → Start bidding; bid via integration API
  // RFQ detail › Bid comparison shows the rate 'PKR 1,250.00 / kg'; Accept → PO appears in Orders with total 'PKR 125,000.00'
});
test('rejecting a supplier or a bid needs a reason', async ({ page }) => { /* Reject keeps the form open with the field error until a reason is typed */ });
test('tracking without a configured provider shows a message, not a broken page', async ({ page }) => {
  // Orders › Tracking: enter B/L 'MSCUBL1234' → Track → warning 'not configured'; the page still lists the PO
});
test('the PM records an arrived lot against the PO and the inspector is told', async ({ page }) => { /* PO detail › Record arrived lot */ });
test('claim notices are read-only for the purchase manager', async ({ page }) => { /* no decide button */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test e2e/purchase.spec.ts --project=desktop-chromium`
Expected: FAIL.

- [ ] **Step 3: Implement the sections** (spec 8.2.1–8.2.13)

Dashboard (pending suppliers, open RFQs closing soonest, awards waiting for admin as a `NextStep`); Suppliers list with status and category filters; Pending suppliers with Approve and Reject (`ReasonField`); Supplier profile (details, categories, ratings and feedback, QC pass rate, on-time rate, claim outcomes, a Rate form 1–5 with feedback); Create RFQ; RFQ list and detail with Start bidding, End bidding, Cancel (`ReasonField`); Bid comparison table sorted by total with Accept and Reject (`ReasonField`); Awards pending admin approval; PO list and detail (quantity change, B/L entry, Record arrived lot, its lots); Shipment tracking (B/L lookup with cached status, last checked time, error banner); Claim notices (read-only); Supplier performance analytics. Every action form carries `InterventionField owners={['purchase_manager']}`. Register `MODULES.purchase_manager` in `src/ModuleViews.tsx`; consume `/erp/orders/pending-approvals` for the PM awards view, never the admin-only approvals API. Display amounts in the response currency.

Update `e2e/roles.spec.ts` Pervaiz sections to Dashboard, Suppliers, RFQs, Orders, Claims, Analytics (+ common four); supplier notification now opens its profile instead of Notifications. Test the same supplier notification as admin opens `#/modules/purchase/suppliers/.../<id>` with the actual admin member. Final retirement here removes only the now-disabled goods-receipt write stubs/history routes and adapted IncomingStock screen, whose arrival behavior moves into PurchaseScreens.

- [ ] **Step 4: Run e2e, unit tests and the type check**

Run: `npx tsc -b && npm test && npx playwright test --project=desktop-chromium`
Expected: tsc silent; `fail 0`; Playwright `passed`, none failed.

- [ ] **Step 5: Commit**

```bash
git add src/PurchaseScreens.tsx src/roles.ts src/LiveApp.tsx src/ErpCommon.tsx server/inventory.mjs tests/procurement-api.test.mjs e2e src/ModuleViews.tsx
git rm src/Procurement.tsx src/IncomingStock.tsx server/receiving.mjs
git commit -m "Add the purchase manager screens and retire the old procurement and goods-receipt screens"
```

### Task 20: Sales Manager and Dispatch screens

**Files:**
- Create: `src/SalesScreens.tsx`, `src/DispatchScreens.tsx`, `e2e/sales-dispatch.spec.ts`
- Modify: `src/roles.ts` (sales_manager and dispatch `NAV`), `src/ModuleViews.tsx` (import/register SalesScreens and DispatchScreens), `src/LiveApp.tsx`, `src/erp.css` (retained sales styles), `e2e/roles.spec.ts` (sales/dispatch NAV and links)
- Delete: `src/Sales.tsx`, `src/BuyerPortal.tsx`, `src/sales-client.ts`, `src/sales.css` (move any class still used into `src/erp.css`)

**Interfaces:**
- Consumes: `/erp/sales*`, `/erp/stock/queries`, `/erp/dispatch*`, `/erp/analytics/sales`.
- Produces: `SalesScreens(props)`, `DispatchScreens(props)` with the same props as `PurchaseScreens`.

- [ ] **Step 1: Write the failing e2e spec** (`e2e/sales-dispatch.spec.ts`)

```ts
test('a pending buyer is approved, their held RFQ is quoted, accepted and noted as a sale with an 18% GST invoice', async ({ page }) => {
  // buyer + RFQ via integration API (buyer token) → Sana: RFQ shows 'Awaiting buyer approval' and no Quote button
  // Buyers › Pending → Approve; Quote 100 kg at PKR 1,250.00, 30 days credit → Send; acceptance via integration API
  // Note sale → invoice detail shows Subtotal 'PKR 125,000.00', 'GST (18%)' 'PKR 22,500.00', Total 'PKR 147,500.00', number /^INV-\d{4}-0001$/, no edit controls
});
test('a stock availability query is answered by the supervisor', async ({ browser }) => { /* Sana asks; Saima answers 80 kg via API; Sana sees '80 kg' */ });
test('a partial payment shows partially paid, then paid', async ({ page }) => { /* Payments: record PKR 50,000 → 'Partially paid'; record the rest → 'Paid' */ });
test('dispatch requests approval, the sales manager holds with a reason, then approves; stock drops only on dispatch', async ({ browser }) => {
  // Danish: New dispatch for the order → 'Pending approval'; Sana: Dispatch requests › Hold needs a term and reason → 'On hold'
  // Danish re-requests; Sana approves; Danish marks Dispatched → the lot's finished kg falls by 100
});
test('dispatch raises a stock issue to the supervisor', async ({ page }) => { /* shortage 2 kg → Saima has a notification */ });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx playwright test e2e/sales-dispatch.spec.ts --project=desktop-chromium`
Expected: FAIL.

- [ ] **Step 3: Implement the sections**

Sales (8.5.1–8.5.12): dashboard (`NextStep` for the oldest pending buyer, RFQ or dispatch request; overdue total); buyer list with status filter; pending buyers with verification details, Approve and Reject (`ReasonField`); buyer RFQ list and detail (respond only when the buyer is approved; held RFQs say why); stock availability query; quotation form (rate, specifications, payment terms, credit days; currency shown, not chosen); Note sale; invoice list and detail (locked; subtotal, GST, total, due date, credit notes with `ReasonField`; download); payment tracking (due dates, partial payments, status tags, record payment); credit alerts list; dispatch approval requests (Approve, Hold with term and `ReasonField`, hold notice on an approved dispatch); sales analytics tables.
Dispatch (8.6.1–8.6.7): dashboard; dispatch list by status tabs; detail with a status thread (Pending approval → Approved → Dispatched → Delivered, hold branch), optional vehicle, transporter and delivery proof; Request dispatch approval; Hold dispatch (needs a sales-manager notice and `ReasonField`); Raise stock issue; Dispatch history (delivered). No control edits invoices, prices or terms. Register both `MODULES`.

Delete BuyerPortal together with sales-client so TypeScript has no dangling import; its hash route already went in Task 1. Register both components in ModuleViews. Update `e2e/roles.spec.ts`: Sana sections Dashboard, Buyers, Buyer RFQs, Invoices, Dispatch requests, Analytics; Danish Dashboard, Dispatches, New dispatch, History (+ common four each). Dispatch loses legacy Stock here. Test invoice and dispatch notifications for owner roles and admin module destinations. Sales analytics/overdue displays label each currency group. New dispatch selection visibly rejects raw and legacy cops/WIP with the Task 14 explanation.

- [ ] **Step 4: Run e2e, unit tests and the type check**

Run: `npx tsc -b && npm test && npx playwright test --project=desktop-chromium`
Expected: tsc silent; `fail 0`; Playwright `passed`, none failed.

- [ ] **Step 5: Commit**

```bash
git add src/SalesScreens.tsx src/DispatchScreens.tsx src/roles.ts src/LiveApp.tsx src/erp.css e2e src/ModuleViews.tsx
git rm src/Sales.tsx src/BuyerPortal.tsx src/sales-client.ts src/sales.css
git commit -m "Add the sales manager and dispatch screens"
```

### Task 21: Quality Inspector and Supervisor screens; retire the legacy stock entries

**Files:**
- Create: `src/QualityScreens.tsx`, `src/SupervisorScreens.tsx`, `e2e/quality-supervisor.spec.ts`
- Modify: `src/roles.ts` (quality_inspector and supervisor `NAV`), `src/ModuleViews.tsx` (import/register QualityScreens and SupervisorScreens; admin legacy sections were removed in Task 18 and Dispatch Stock in Task 20), `src/LiveApp.tsx` (delete `InventoryForm` and the movement, QC and reversal actions; `LotDetail` keeps the batch facts, QR label and evidence), `src/WorkspaceDashboard.tsx` (supervisor dashboard reuses `StockFlow`)
- Modify: `server/inventory.mjs` (delete `saveMovement`, `POST /api/movements`, `/api/reversals`, `/api/quality`, `/api/inspections`, `POST /api/lots`, `POST /api/photos`)
- Modify: `tests/inventory-api.test.mjs` (keep only the PIN sign-in, two-devices, isolation and cross-origin tests; their setup adds stock through `/erp/stock/finished`), `tests/stock.test.mjs` (add the legacy-route test below), `scripts/demo-stock.mjs` (four finished lots through `/products` and `/erp/stock/finished`, signed in as `Saima`)
- Modify: `e2e/inventory.spec.ts`, `e2e/every-button.spec.ts` (stock tests follow the supervisor screens; delete steps for removed receive, transfer, QC and reversal forms)
- Modify: `e2e/roles.spec.ts` (quality/supervisor NAV and role-aware notification links).

**Interfaces:**
- Consumes: `/erp/qc/*`, `/erp/stock/*`, `/erp/dispatch/stock-issues*`, `/erp/stock/history`.
- Produces: `QualityScreens(props)`, `SupervisorScreens(props)`.

- [ ] **Step 1: Write the failing tests**

`tests/stock.test.mjs` gains:

```js
test('raw inventory enters only through QC-approved lots', async () => {
  // POST /movements, /reversals, /quality, /inspections, /lots and POST /photos → 404; POST /erp/stock/raw → 404
});
```

`e2e/quality-supervisor.spec.ts`:

```ts
test('an inspector inspects a lot with photos and an issue; the supervisor accepts and confirms', async ({ browser }) => {
  // seed via API: approved PO with B/L and an arrived 100 kg lot. Qasim: Lots → Inspect: accepted 80, rejected 20
  // Submit without a photo → 'Upload at least one photo of the accepted quantity.'; upload e2e/fixtures JPEG; add issue (Shade variation, Major)
  // Submit → My submissions shows 'Pending'. Saima: Reviews › Reports → Accept → Inventory lists the lot with 80 kg raw, source 'QC-approved lot'
  // Reviews › Issues → Confirm → claim created; Qasim's notifications include 'Supervisor decision returned'
});
test('a returned report shows its reason under Returned items', async ({ browser }) => { /* Saima rejects with reason → Qasim › Returned shows it */ });
test('a write-off needs a reason and, at the threshold, waits for admin', async ({ page }) => { /* adjust form; 'Sent to the admin for approval' */ });
test('the supervisor answers a stock query and files the report to admin with a flagged item', async ({ page }) => {
  // Setup: Sana creates a stock query for a seeded product via API; seed one confirmed rejection in the report period.
  // Saima: Requests › Queries → answer 80 kg and 'Available in bay 3'; Save. Sana GET queries asserts available_grams=80000 and the exact answer.
  // Saima: Report → select the period, flag that rejection with 'Review shade evidence before reorder', Submit → saved report id.
  // Anas: Reports → open that id; assert supervisor Saima, confirmed rejection id, photo evidence, flagged note and submitted period are visible.
  // Refresh and assert the report and flag persist; no duplicate report is created.
});
```

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/stock.test.mjs && npx playwright test e2e/quality-supervisor.spec.ts --project=desktop-chromium`
Expected: FAIL.

- [ ] **Step 3: Implement the sections and remove the legacy entries**

Quality Inspector (8.3.1–8.3.7): dashboard (`NextStep` for the oldest lot awaiting inspection); lot list (PO, supplier, quantity, status); inspection form (accepted and rejected quantity with the open quantity shown); photo upload (`<input type="file" accept="image/jpeg,image/png,image/webp" capture="environment">`, thumbnails with time taken; required before Submit when accepted > 0); raise issue form (type, severity Minor/Major/Critical, description, optional photos); my submissions with report and rejection status tags; returned items with the supervisor's reason. The inspector has no inventory or decision controls.
Supervisor (8.4.1–8.4.10): dashboard (`NextStep` for the oldest report or issue, then `StockFlow`); inspector reports queue (Accept, Reject with `ReasonField`, photos); issues queue (Confirm, Dismiss with `ReasonField` and outcome Re-inspect / Accept with deviation, Escalate); add inventory (finished goods as production output; raw explained as arriving through accepted reports); inventory list and detail (type, source and raw/cops/WIP/finished kg; legacy cops/WIP explicitly read-only); adjustment and write-off form (`ReasonField`, shows when admin approval will be needed); stock queries (answer with available kg); dispatch stock issues (Accept with optional correction requiring `ReasonField` when non-zero, preview both approval gates; Reject with `ReasonField`); report to admin (draft preview of confirmed rejections with reasons and photos, escalations, adjustments; flag items with notes; Submit); decision history.

Use Task 11 `/erp/stock` adjustmentThreshold for preview and Task 14 `/erp/dispatch/stock-issues` for the supervisor queue and both gate values; no supervisor call to admin-only settings/approvals. Register QualityScreens/SupervisorScreens in ModuleViews. Update `e2e/roles.spec.ts` Qasim sections Dashboard, Lots, Submissions; Saima Dashboard, Reviews, Inventory, Requests, Report, History (+ common four). Assert QC/stock issue notification links open their role's exact item and admin module equivalents. Preserve legacy-stage read visibility after deleting the legacy Stock UI; final removal of write stubs is here, not Task 20.

- [ ] **Step 4: Run all tests, the type check and e2e**

Run: `npm test && npx tsc -b && npx playwright test --project=desktop-chromium`
Expected: `fail 0`; tsc silent; Playwright `passed`, none failed.

- [ ] **Step 5: Commit**

```bash
git add src/QualityScreens.tsx src/SupervisorScreens.tsx src/roles.ts src/LiveApp.tsx src/WorkspaceDashboard.tsx server/inventory.mjs tests/inventory-api.test.mjs tests/stock.test.mjs scripts/demo-stock.mjs e2e src/ModuleViews.tsx
git commit -m "Add the inspector and supervisor screens and retire the old free-form stock entries"
```

### Task 22: Remove the supplier and buyer portal screens and the transitional permission layer

**Files:**
- Delete: `src/SupplierPortal.tsx`, `server/supplier-portal.mjs`, `server/buyer-portal.mjs`, `tests/procurement-api.test.mjs`, `e2e/procurement.spec.ts`
- Modify: `src/main.tsx` (render `LiveApp` only), `src/ErpCommon.tsx` (delete `BidForm`, `DispatchNotice`), `src/inventory-client.ts` (delete `Permission`, `can`, `Member.permissions`), `src/roles.ts`/screens (no `can()` left)
- Modify: `server/inventory.mjs` (delete the `/api/portal/*` and `/api/buyer/*` branches, its separate local `allow` helper and all remaining call sites; currentMember stops returning permissions), `server/procurement.mjs` (delete `supplierOperations`), `server/auth.mjs` (delete `ROLE_PERMISSIONS`), `server/erp-utils.mjs` (delete `allow`)
- Modify: `tests/integration.test.mjs` (add the test below)
- Modify: `tests/rbac.test.mjs` (replace temporary permissions assertion with effective six-role access and no permissions property), `e2e/roles.spec.ts` (removed portal hashes render only the factory app). `src/BuyerPortal.tsx` was already deleted in Task 20.

**Interfaces:**
- Consumes: everything above.
- Produces: the member object is `{ user_id, workspace_id, name, role, admin }`; `submitBid` (Task 15) is the only bid path.

- [ ] **Step 1: Write the failing test**

```js
test('the factory no longer serves portal session APIs', async () => {
  // POST /portal/login → 404; POST /buyer/login → 404; GET /portal/config → 404
});
```

In `e2e/roles.spec.ts` add `test('removed external portal hashes never render portal screens')`: visit `#/supplier` and `#/buyer` signed out and signed in; assert the factory sign-in/dashboard respectively, no supplier/buyer registration or portal controls. Retain these negative-route literals only in this named regression. In `tests/rbac.test.mjs`, replace `member.permissions includes receive/catalog` with effective role checks: supervisor finished entry allowed, PM/QI/dispatch denied, supervisor admin-users denied; assert `Object.hasOwn(member,'permissions') === false`. Cover all six role destinations/access and next-request role changes; no dot-permissions reference remains.

- [ ] **Step 2: Run to verify failure**

Run: `node --test tests/integration.test.mjs`
Expected: FAIL (portal routes still answer).

- [ ] **Step 3: Delete the files and branches listed above**

The supplier and buyer identity tables (`supplier_users`, `supplier_sessions`, `buyer_users`, `buyer_sessions`, `portal_rate_limits`) keep their rows and are no longer read or written.

Explicitly update the Task 1 RBAC regression above before removing the shim; remove both shared and inventory-local allow helpers and replace any surviving caller with its responsible role check. Do not delete migration preservation fixtures merely to satisfy the search; use legacy-column SQL where needed, with no runtime permission dependence.

- [ ] **Step 4: Verify nothing still references the removed layer**

Run: `rg -n "\ballow\(|ROLE_PERMISSIONS|\bPERMISSIONS\b|\.permissions\b|\bcan\(|supplierOperations" server src e2e tests`
Expected: no output. Separately run `rg -n "#/supplier|#/buyer|/portal/|/api/buyer/" server src e2e tests`; only the explicit negative-route assertions in `tests/integration.test.mjs` and `e2e/roles.spec.ts` may match; inspect every match, with none in production sources.

- [ ] **Step 5: Run all tests, the type check, the build and e2e**

Run: `npm test && npx tsc -b && npm run build && npx playwright test --project=desktop-chromium --project=iphone-webkit`
Expected: `fail 0`; tsc silent; build finishes without errors; Playwright `passed`, none failed.

- [ ] **Step 6: Commit**

```bash
git add -A src server tests e2e
git commit -m "Remove the supplier and buyer portal screens and the old permission layer"
```
