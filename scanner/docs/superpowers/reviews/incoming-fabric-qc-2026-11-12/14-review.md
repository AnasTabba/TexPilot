# Reviewer 14 — DB, audit, concurrency and migration

Recommendation: revise before implementation. No P0 found; three P1 and two P2 findings below concern proposed contracts/implementation instructions, not claims that unshipped QC code is already defective. Existing v1 data must remain unchanged.

## Inspected paths and behavior

- `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md`, including integrated §§14–16; `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md`, including integrated acceptance additions.
- `scanner/services/api/store.py`: existing diagnostic store writes photos before an independent SQLite result transaction; no tenant or v2 authoritative storage.
- `yarnflow/server/sqlite.mjs:2–30`: prepared statements and atomic preassembled batches; no interactive transaction callback. `server/quality.mjs:27–42` explicitly aborts batches on failed state assertions instead of trusting zero-row updates; existing decisions can invoke receipts/claims and must remain separate.
- `yarnflow/server/d1-bucket.mjs:7–23`, `scripts/dev-server.mjs:18–27,48–55`, `server/cloudflare.mjs`, `wrangler.jsonc`: local filesystem versus published D1-backed object fallback; local migration runner orders SQL filenames and atomically records each basename. Published configuration uses Wrangler migrations and has no R2 binding.
- All 34 current `yarnflow/drizzle/*.sql` files applied in an isolated in-memory SQLite database for inspection, notably `0002_procurement.sql`, `0006_audit.sql`, `0013_quality.sql`, `0022_photo_chunks.sql`, `0030_qc_corrections.sql`, `0031_reversals.sql`, `0032_chat_updates.sql`; existing audit append-only triggers and PO identity constraints inspected. No repository DB or product files changed.

## Findings

### P1-14-01 — Composite tenant FKs cannot reference the existing PO key as proposed without an additive parent index

**Evidence:** Design §9 line145 requires composite tenant foreign keys on all tenant rows and new specs/samples reference existing POs. `yarnflow/drizzle/0002_procurement.sql` defines `supplier_purchase_orders.id` as the primary key and `UNIQUE(workspace_id,reference)`, with no unique `(workspace_id,id)` key; the later migrations do not supply it. T02's file/step list does not identify the required parent-key expansion. An isolated probe after applying all 34 real migrations created a child FK to `(workspace_id,id)` successfully but its first INSERT failed with `foreign key mismatch`. Merely creating tables successfully therefore cannot prove migration acceptance.

**Correction:** T02 should explicitly add the non-destructive unique parent index for `(workspace_id,id)` before creating dependent QC tables, enumerate each composite parent tuple (including spec version and sample/evidence ownership), and retain the existing primary keys. Any other legacy parent referenced by tenant tuple needs the same check. Do not replace composite ownership enforcement with an application-only lookup.

**Test assertion:** On a populated migrated DB, a same-workspace PO/spec/sample chain inserts successfully; an existing foreign-workspace PO fails as a constraint violation; `PRAGMA foreign_key_check` is empty. Run equivalent writes through local binding and actual Wrangler/D1 migration path, then verify the old PO reader still works.

### P1-14-02 — Capture-set closure has no wire contract, so attempt allocation remains contradictory

**Evidence:** Plan endpoint map line40 says POST `/samples/:id/captures` uploads an original and allocates an attempt. Design §14 line188 instead says attempts count submitted sets, never individual overview/marker files, and that a selected set closes atomically. `Capture` in §3 has no set/submission identifier or membership/closed state. T02 exposes only create/finalize helpers; T05 tests duplicate uploads but does not specify the operation that closes a set. The integrated retry assertion does not define how two different views, concurrent closes, or an interrupted last upload map to one attempt. Existing `server/quality.mjs:308–327` handles individual photo attachment, not this proposed set lifecycle.

**Correction:** Define one bounded operation that submits a complete ordered capture set (or an explicit close operation if individual uploads remain), including durable submission ID, expected revision, required-role membership and canonical content hash. Allocate one attempt only when that set commits; retries replay the closure, and analysis consumes that immutable set. Update endpoint map, T01 fixtures and T02/T05 acceptance together.

**Test assertion:** Overview+structure+scale consume exactly one attempt; replaying any member/closure changes neither counter; two simultaneous closes cannot allocate two attempts for the same submission; crash before closure consumes none; changing a closed member requires a new submission and invalidates prior current evidence. Attempt three must mean the third submitted set.

### P1-14-03 — Blob grace-period GC lacks a fence against late reference commits

**Evidence:** Design §9 line145 orders pending object write, checksum, reference commit and finalization, while promising orphan GC after a grace period and never deleting live references. No pending-object state/claim protocol or finalization precondition is defined in T02/T05/T12. Actual `server/d1-bucket.mjs:9–14,23` puts/deletes objects in transactions separate from metadata; `scripts/dev-server.mjs:50–53` does filesystem writes/deletes outside DB transactions. A GC worker can see no reference, an uploader can commit a reference, and GC can then delete the now-live object. A grace period alone does not prevent this if upload/finalization resumes late.

**Correction:** Give pending objects an explicit durable state and make reference acquisition and GC claiming mutually exclusive conditional DB transitions. Once GC claims an object, metadata commit must fail/reupload; only a claimed unreferenced object may be deleted. Use immutable content-addressed object keys and preserve a retryable deletion state after object-store failure. No distributed transaction or new queue service is required.

**Test assertion:** Pause GC after selecting an orphan, race metadata finalization, then resume deletion: either the live reference wins and bytes remain, or GC wins and finalization cannot publish the reference. Repeat with filesystem and D1 fallback; inject crashes after each transition and verify eventual cleanup without deleting live captures.

### P2-14-04 — Atomic finalization needs an explicit abort-on-failed-precondition batch pattern

**Evidence:** T02 lines62–66 promises optimistic finalization but specifies no guard semantics. Design §§9/15 require spec/release/revision/current authorization checks at commit. Actual `server/sqlite.mjs:18–24` executes a preassembled batch and commits even when a conditional UPDATE changes zero rows; checking `meta.changes` after `batch()` is too late. Existing `server/quality.mjs:27–42` already owns an appropriate aborting assertion pattern. An isolated SQLite probe with revision mismatch committed a following event INSERT despite zero changed sample rows.

**Correction:** Require T02 to build a batch whose first SQL assertions abort on stale revision, tenant/role/release/spec/capture binding failure, followed by decision/event/idempotent-response writes. Extend/reuse the existing state-guard pattern at the QC owner; do not implement a JS read/check followed by an independently committed write, or inspect affected rows only after commit.

**Test assertion:** Force the precondition UPDATE to match zero rows and assert zero evidence, decision, audit, idempotent-success and pointer writes. Interleave release suspension or role removal between preliminary read and batch execution and require the same all-or-nothing failure on both adapters.

### P2-14-05 — Retention policy and immutable audit storage have no executable transition contract

**Evidence:** Design §8 line139 proposes 30-day research-original and 180-day audit retention, requiring purge/tombstones and backup expiry; §9 line145 declares append-only decision events and immutable evidence. Existing `drizzle/0002_procurement.sql` prevents audit UPDATE/DELETE; `0006_audit.sql` adds actor and old/new payloads. The plan puts rights/retention in T09 and a deletion/backup drill in its proof matrix, but no T02/T09/T12 owning file, schema or operation defines how audit expiry, original deletion, evidence hash references and holds interact. Copying existing audit immutability can make the signed retention agreement impossible to execute; deleting referenced evidence can instead break history.

**Correction:** Before collection, distinguish retained immutable minimal decision metadata from purgeable identity/image payloads, specify tombstone/read behavior and legal-hold precedence, and assign the purge/backup-expiry implementation and test to an explicit task. Do not silently relax existing ERP audit triggers or delete legacy audit. Keep provisional durations provisional until G4 authority signs them.

**Test assertion:** With an injected clock and a test approved retention policy, an expired research original becomes inaccessible while decision hashes/history remain interpretable with an explicit deletion tombstone; a hold blocks deletion; retries are idempotent; restore/reconciliation does not resurrect expired accessible payloads. Existing ERP audit UPDATE/DELETE must still fail.

## Proof and authority limits

Focused proof used Python stdlib SQLite only: applied all current migration SQL in memory, inspected actual PO indexes, reproduced the composite-FK mismatch and zero-row-CAS continuation. These are local SQL facts, not D1 execution, backup recovery, physical validation or security signoff. The plan already correctly prohibits PASS-to-ACCEPT migration, destructive contraction, inventory conversion and blind snapshot rollback; its placeholder migration number explicitly requires rechecking the maximum, so the occupied 0031 number alone is not reported as an unmitigated defect.

G4 retention/consent and G8 recovery/security approval remain external authority gates; this review neither grants them nor asks implementation to invent them. Proceed with additive storage only after resolving the contract gaps above, then prove populated migration/replay and isolated DB+blob recovery before pilot. Automatic decisions remain gated by the independent release requirements; resolving these storage issues does not authorize automation.
