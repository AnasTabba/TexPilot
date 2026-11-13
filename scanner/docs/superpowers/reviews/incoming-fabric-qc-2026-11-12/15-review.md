# Reviewer 15 — web workflow/offline

Recommendation: **revise T07 before implementation approval**. No P0 identified. The design correctly makes offline capture draft-only and gates automatic decisions; the gaps below are proposed implementation/proof gaps, not claims that QC v2 already exists.

## Inspected paths

- `scanner/docs/superpowers/specs/2026-11-12-incoming-fabric-qc-design.md` (§§3, 9–10, 14 and release gates).
- `scanner/docs/superpowers/plans/2026-11-12-incoming-fabric-qc.md` (contracts, dependencies, T05–T08, T12 and integrated acceptance).
- `yarnflow/src/main.tsx`, `LiveApp.tsx`, `App.tsx`, `inventory-client.ts`, `scanner-client.ts`.
- `yarnflow/public/sw.js`, `scripts/prepare-offline.mjs`, `scripts/dev-server.mjs`, `playwright.config.ts`, `package.json`.

## Findings

### P1 — T07 does not own the actual session invalidation boundary, including other tabs

**Evidence:** Design line 153 requires logout/account/workspace purge and reauthentication before upload; plan lines 120–126 names App/navigation and `clearQCDrafts(workspaceId)` but no session lifecycle integration. Actual entry point is `main.tsx:10,28`, which renders LiveApp. `LiveApp.tsx:275–294` locks only the current component and sends logout; `309` handles 401 separately without the signOut cleanup. `313` polls only visible tabs; there is no storage/BroadcastChannel listener in LiveApp. A hidden/offline second tab can retain a proposed memory draft, request key and rendered result across another tab's sign-out/sign-in. Clearing durable storage in the first tab alone cannot invalidate another tab's memory or late callback.

**Correction:** Explicitly assign T07 changes to LiveApp's session lifecycle. Bind all QC draft/result/request state to workspace, actor and a session generation; invalidate before async logout, on identity change and on 401, with cross-tab invalidation and a freshness check before reconnect/upload. Define whether session expiry purges or quarantines for same-actor reauth; never attach an old actor's queued request to a new actor. Keep server authorization authoritative.

**Test assertion:** Two tabs share a session; B has a draft and deferred analyze response. A logs out (including failed/offline logout) and signs in as another actor in the same workspace. B must hide the prior result, discard accessible drafts/object URLs, ignore the deferred response and send zero queued uploads under the new actor. Repeat for workspace change and 401.

### P1 — The web storage protection fallback and 24-hour expiry are requirements without an executable acceptance gate

**Evidence:** Design line 153 requires encrypted/OS-protected storage or explicitly warned memory-only drafts, plus expiry after 24 hours; line 151 requires storage caps and blob URL cleanup. T07 line 124 tests only “offline drafts never decisions” and workspace/logout purging, omitting protection selection, expiry, quota and cleanup. The actual app already uses localStorage for form drafts (`LiveApp.tsx:67` and `98`), so copying the existing draft pattern would persist sensitive QC originals without satisfying this new contract. Proposed `qc-drafts.ts` has no specified storage/protection/clock interface.

**Correction:** For the initial web slice explicitly choose memory-only originals with a visible reload-loss warning unless protected persistent storage is demonstrated on supported browsers. Define byte/count caps, creation-based expiry, object URL ownership and cleanup on replacement/unmount/purge. Give T07 focused acceptance tests; ordinary IndexedDB availability must not itself count as proof of encryption or OS protection.

**Test assertion:** In unsupported/protection-unproven mode, no original or sensitive draft metadata reaches localStorage, IndexedDB or Cache Storage; reload loses the draft with the promised warning shown beforehand. At exactly 24 hours an open draft cannot upload/analyze and is purged; replacement, expiry, quota failure and logout release all owned object URLs without a decided status. If persistence is selected, add platform-specific protection evidence and reload/expiry tests.

### P2 — Service-worker privacy and upgrade cleanup are not assigned to T07

**Evidence:** Design line 153 forbids sensitive API/image service-worker caching and requires cache purge. Existing `public/sw.js:4` correctly bypasses `/api/` and requests marked no-store, but otherwise caches every successful same-origin GET; it is not a static-asset allowlist. `sw.js:3` claims clients without deleting old caches, while `scripts/prepare-offline.mjs:3–12` creates a new cache name per asset set. Neither file is in T07's modification list. Consequently the proposed guarantee depends on every future image URL remaining under `/api/` or every fetch carrying no-store; image element requests do not inherit the inventory client's fetch options (`inventory-client.ts:46–49`). Old cache cleanup is also unowned.

**Correction:** Assign the worker/build generator to T07, or explicitly constrain every QC image URL to the excluded namespace and test that invariant. Prefer a static-shell allowlist, no private navigation/image caching and version-scoped obsolete shell cleanup; preserve the literal replacement contract in prepare-offline if changing worker syntax. Define QC-sensitive cache purge separately from harmless offline shell retention.

**Test assertion:** Under an active built worker, fetch QC metadata and load an original/preview as an image; enumerate Cache Storage and prove none contains private bytes. Logout followed by offline navigation cannot recover them. Upgrade from the prior worker and prove obsolete caches are removed while the new shell still opens offline.

### P2 — The stated T07 command can test an old build and does not prove production offline behavior

**Evidence:** T07 line 125 runs typecheck, a Node test and Playwright without building. `playwright.config.ts:14` starts `scripts/dev-server.mjs`, whose static handler reads `dist` (`dev-server.mjs:84–89`); it does not build the proposed component or prepared worker. Only package.json's build runs Vite plus prepare-offline. `main.tsx:35–37` registers the worker only in PROD. Thus the named green gate can exercise stale dist, fail because dist is absent, or omit worker activation rather than validate the reviewed source. Unit tests cannot establish browser Cache Storage isolation.

**Correction:** Make T07's browser gate explicitly build the current source first and wait for service-worker readiness/controller activation in a fresh browser context. Disable reuse of an unrelated existing server for the recorded acceptance run. Add a production offline scenario rather than treating the presence of Playwright as proof.

**Test assertion:** From a clean generated-output state, the documented command builds and serves the current QC screen; assert the page is service-worker controlled, then disconnect, capture a draft, reconnect/retry with the same key and verify one server submission. Record browser/project and build identity; no pre-existing dist or running server is required.

## Authority and proof boundaries

These corrections are web engineering gates and need no invented factory approval. They do not authorize ACCEPT/HOLD: independent QC signoff, calibrated release/domain evidence, capture consent/retention approval and other G1–G8 evidence remain external gates. A fluent reviewer and real-phone accessibility/low-connectivity study are still needed for the design's Urdu/operator claims; passing axe or browser emulation does not discharge those gates.

Review proof was source tracing only; no product files changed, dependencies installed, GPU jobs launched or product test success claimed. Resolve the two P1 ownership/acceptance gaps and the production-worker proof gaps, then the review-only web slice has a coherent implementation path.
