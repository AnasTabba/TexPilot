# 06 — Architecture (built to last)

## 1. Guiding choices
- **Boring, popular, typed.** TypeScript end-to-end, PostgreSQL, a small number of mature libraries.
- **Domain logic in one shared package**, used by both client (offline validation, previews) and
  server (authoritative validation). One set of rules, two places.
- **Append-only ledger** makes offline sync simple: entries are inserts, not updates, so conflicts
  are rare and explainable.
- **No vendor lock-in:** standard Postgres, containerised API, open export formats (CSV/XLSX/JSON).

## 2. Recommended stack (agent may propose alternatives in `docs/DECISIONS.md` with reasons)
| Layer | Choice | Why |
|---|---|---|
| Monorepo | pnpm workspaces: `apps/web`, `apps/api`, `packages/domain`, `packages/ui`, `packages/i18n` | Shared types/rules |
| Web | React + TypeScript + Vite, `vite-plugin-pwa` (Workbox) | Fast, installable, offline shell |
| Routing / data | React Router, TanStack Query | Caching, retries, background refresh |
| Forms | react-hook-form + Zod (schemas from `packages/domain`) | Same validation client/server |
| UI primitives | Radix UI (or React Aria) + Tailwind using CSS-variable tokens | Accessible, RTL-capable, themeable from templates |
| Local DB | IndexedDB via Dexie: outbox, drafts, cached masters, balances snapshot | Offline-first |
| i18n | i18next + ICU messages; `dir` switching; logical CSS | EN/UR |
| Charts | Apache ECharts or Recharts (RTL-tested) | Mature, accessible table fallback |
| Scanning | BarcodeDetector API with ZXing fallback | Works on Android Chrome |
| API | Node.js + Fastify, Zod validation, OpenAPI generated | Simple, fast, typed |
| ORM / migrations | Drizzle ORM with SQL migrations (forward-only) | Transparent SQL |
| Database | PostgreSQL 16+ (managed, with point-in-time recovery) | Integrity, longevity |
| Jobs | pg-boss (Postgres-backed queue) | Exports, reports, notifications without extra infra |
| PDF | Server-side HTML → PDF via headless Chromium (Playwright) | Correct Urdu Nastaliq shaping |
| Files | S3-compatible object storage (photos, PDFs) | Portable |
| Auth | Own auth: PIN (argon2id) + device registration; OTP for Owner/Manager | Fits shared factory phones |
| Observability | Error tracking (e.g. Sentry), structured JSON logs without PII, uptime check | Find problems before users report them |
| Tests | Vitest (unit/integration), Testcontainers Postgres, Playwright (e2e, EN/UR, mobile/desktop), axe-core (a11y), fast-check (property tests for ledger) | |
| CI | Typecheck, lint, tests, a11y, i18n key check, build, migration dry-run on every PR | |

Hosting: any container host + managed Postgres in the region closest to Pakistan with good
latency; must support daily backups and point-in-time recovery.

## 3. Data model (core tables; all with `created_at`, `created_by`, `updated_at`, soft-archive flags)
```
factories, users(role, pin_hash, language, active), user_permissions, devices(approved, revoked)
product_types, yarn_counts, contents, blend_ratios, specs(product_type, fields…, label, archived)
spec_packing_defaults(spec_id, cones_per_carton, kg_per_cone, tolerance_pct)
suppliers, customers, machines(kind: winding|tfo), shifts(start, end, crosses_midnight)
lots(lot_no, supplier_id, spec_id, status, received_date)
fabric_types, gsm_bands, selection_guide(fabric_id, gsm_from, gsm_to, spec_ids[], notes)
waste_types, downtime_reasons, void_reasons, holidays, settings

transactions(id uuid PK = client_id, type, serial, business_date, shift_id, status,
             device_id, device_time, server_time, payload_snapshot jsonb, notes,
             voided_by, voided_at, void_reason, reverses_txn_id)
transaction_lines(txn_id, line_no, spec_id, spec_label_snapshot, lot_id, machine_id,
                  cartons int, cones int, cops int, grams bigint)
stock_movements(id, txn_id, line_no, stage: raw|machine_wip|cops|finished|waste,
                spec_id, lot_id, delta_cartons, delta_cones, delta_cops, delta_grams)
stock_balances(stage, spec_id, lot_id, cartons, cones, cops, grams,
               CHECK (cartons >= 0 AND cones >= 0 AND cops >= 0 AND grams >= 0))
orders, order_lines(spec_id, grams_ordered), delivery_notes(txn_id, gate_pass, vehicle, driver)
cartons(qr_code, lot_id, spec_id, grams, status, current_txn_id)   -- Phase 3
qc_tests, downtime_events                                              -- Phase 3
day_closes(business_date, shift_id, approved_by, remarks, reopened_by, reopen_reason)
month_locks(month, locked_by, unlocked_by, reason)
serial_counters(type, year, next_value)
attachments(txn_id, storage_key, mime, bytes)
audit_log(entity, entity_id, action, old jsonb, new jsonb, user_id, device_id, at)
sync_cursors(device_id, last_pulled_at)
```
Rules:
- Posting a transaction = one DB transaction: insert txn + lines + movements, update
  `stock_balances` (row-locked `SELECT … FOR UPDATE`), assign serial. The `CHECK` constraint makes
  negative stock impossible even under concurrency.
- Voiding inserts a reversing transaction and movements; original row gets `voided_*` fields.
- `stock_balances` can be rebuilt from `stock_movements` at any time (`pnpm db:rebuild-balances`);
  a nightly job verifies they match and alerts on drift.
- Quantities: integer grams, integer cartons/cones/cops; money integer paisa.
- Time: `timestamptz` in UTC + `business_date` (date) + `shift_id`. Business date computed in
  Asia/Karachi using shift rules.
- Snapshots of labels/names stored in lines so history never changes when masters are renamed.
- Audit via Postgres triggers on all tables except append-only logs.

## 4. Offline sync protocol
- **Push:** `POST /v1/sync/push` with a batch of outbox items `{client_id, type, payload,
  device_time, base_version}`. Server processes each idempotently (unique on `client_id`):
  returns `posted` (with serial) | `rejected` (code + human message key) | `duplicate` (already posted).
- **Pull:** `GET /v1/sync/pull?cursor=…` returns changed masters, balances for relevant
  specs/lots, the user's recent transactions, day/month lock status, settings.
- Client applies optimistic local balances (server balances − pending local movements) and
  labels them "includes N entries not yet sent".
- Background sync on reconnect, on app focus, and every 60 s when online; manual "Sync now".
- Outbox schema versioned; migrations on app update never drop pending items.
- Request `navigator.storage.persist()`; warn when not granted and entries are pending.

## 5. Security
- HTTPS only; HSTS; strict CSP; no third-party scripts on the app origin except error tracking.
- PINs hashed with argon2id; rate-limited login; lockout; owner alerts.
- Device registration: each device has a key pair (WebCrypto); refresh tokens bound to device;
  Owner can revoke devices.
- Access token short-lived (15 min), refresh token rotating (30 days, device-bound).
- Authorisation enforced in the API layer on every endpoint (role + permission overrides +
  assigned machines/tasks); UI hiding is convenience only. Tests for every permission rule.
- Local data: cached data and outbox in IndexedDB, encrypted with a key derived after login
  (WebCrypto AES-GCM) where feasible; wiped on device revoke; logout keeps the outbox until synced.
- Input validation with Zod on every request; parameterised SQL only; file uploads type/size checked.
- Secrets in environment/secret manager; never in repo; dependency scanning in CI.
- Backups: daily automated + point-in-time recovery; weekly encrypted export to separate storage;
  monthly restore drill documented (J04).
- Privacy: collect only needed personal data (names, phones of staff/customers/drivers); export
  and deactivate on request.

## 6. API conventions
- REST, versioned `/v1`, OpenAPI spec generated from Zod; errors as
  `{code, message_key, params, field_errors[]}` — client renders localised human messages.
- Pagination by cursor; filtering via query params matching UI filters.
- All list endpoints support CSV/XLSX export via background job when large.

## 7. Quality gates (CI must pass)
- Typecheck, lint (incl. `jsx-a11y`), unit + integration tests, e2e smoke in EN + UR at 360 px and
  1440 px, axe-core zero serious violations, missing i18n keys = fail, bundle size budget
  (initial JS ≤ 250 KB gz), Lighthouse PWA + performance ≥ 90 on mobile profile.
- Property-based tests: for any random sequence of valid transactions and voids, rebuilt balances
  equal incremental balances and are never negative.

## 8. Longevity practices
- Architecture Decision Records in `docs/DECISIONS.md`.
- Forward-only migrations, each reversible by a new migration; never edit an applied migration.
- Feature flags for Phase 3 modules.
- Domain logic has zero UI/framework imports.
- Seed + fixtures for realistic data (including Urdu names, mixed lots, night shifts).
- Documented runbooks: deploy, rollback, restore backup, rotate secrets, add a user/device.
- Dependency updates monthly; LTS runtimes only.
