# Yarnflow Interaction Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Use superpowers:subagent-driven-development only if that execution approach is selected. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Yarnflow feel immediate, predictable, and comfortable on phones and computers while keeping shared stock, authentication, and inspection evidence correct.

**Architecture:** Extend the existing React app with small shared interaction components, a session-scoped workspace store, and transactional request receipts in the inventory API. Preserve the hash routes, native browser navigation, and existing inventory rules. Ship the data, interaction, and asset/build tracks as separate reviewable changes rather than a single rewrite.

**Tech Stack:** React 19, TypeScript, Vite 6, CSS, native dialog/pointer/history APIs, Cloudflare D1 with a SQLite development adapter, Node tests, Playwright Chromium/WebKit. Add BlurHash and a build-time image decoder only in the image task; no new router, animation framework, or query framework is required.

**Spec:** [Yarnflow product requirements](../../../yarn-erp/PRODUCT.md), the user's 20-item request captured in the coverage table below, and the concrete behavior specified in this plan. This document is a proposal, not an implementation or a claim that checks have passed.

## Global constraints

- Target `yarn-erp/`, the active web app. The separate `ios/` application and unscaffolded `app/` directory are outside this implementation.
- Preserve the product rule: “Stock history is never rewritten: corrections are reversals, and dispatch waits for QC approval.”
- Preserve the product rule: “Only real output reaches the screen: model predictions, label reads and measurements.” Loading imagery must never stand in for scan evidence or a prediction.
- Preserve the current session policy: fresh launch, backgrounding, and page exit lock the workspace; returning requires a PIN. No cache, delayed response, or transition may reveal the previous user's inventory after locking.
- Keep authenticated snapshots in memory only. Draft storage remains scoped by workspace, user, and form. No API response goes into the service-worker cache.
- English and Urdu are first-class. New labels need paired translations; RTL layout must preserve the order of PINs, quantities, identifiers, and shortcuts.
- Keep the established warm palette, cone imagery, typography, and spacious layouts. This is a behavior improvement, not a visual redesign.
- Use a minimum 44 × 44 CSS-pixel target for isolated controls. Avoid overlapping invisible hit regions on neighboring controls.
- Keyboard commands execute immediately. Reduced-motion users receive instant state changes or brief opacity-only feedback; no page slides, shimmer, or decorative floating.
- API confirmation remains authoritative for stock movements, QC approval, reversals, inspections, and account permissions. Optimism initially applies only to material creation and local UI preferences.
- Preserve all existing uncommitted changes. Do not deploy, alter the live database, or change scanner models as part of this plan.

## Review focus

1. A refresh or save resolves after sign-out: the old session must remain locked and no old toast or snapshot may reappear. Covered by Tasks 3–5 and 11.
2. A write commits but its response is lost: retrying the same intent creates exactly one record and returns the original result. Covered by Tasks 2 and 4.
3. Another device changes stock before Undo: reversal may fail, must explain why, and must preserve the original ledger entry. Covered by Task 5.
4. A phone user scrolls, cancels a drag, rotates, or opens the keyboard: a sheet must not dismiss accidentally or cover its last action. Covered by Tasks 1 and 8.
5. A keyboard/Urdu user navigates rapidly or changes permissions mid-session: commands, focus, browser history, and motion must stay coherent. Covered by Tasks 6–8 and 11.

## Coverage of the 20 requested items

Numbering normalizes the pasted list; “Interruptible animations” is item 11.

| # | Requested feature | Current evidence / implementation decision | Task |
| --- | --- | --- | --- |
| 1 | Skeleton loaders | Replace text-only cold-loading states with layout-matched placeholders; retain real content during refresh. | 3, 9 |
| 2 | Optimistic updates | New materials appear immediately as pending; reconcile or roll back that one entry. Stock/QC remain confirmed. | 4 |
| 3 | Command menu | Add a searchable, accessible palette for pages, batches, and permitted actions. | 6 |
| 4 | Shortcut hints | Show platform-aware `⌘ K` / `Ctrl K`, arrow, Enter, and Escape hints where relevant. | 6 |
| 5 | Undo toasts | Elevate the existing reversal flow into a persistent actionable toast without deleting history. | 5 |
| 6 | Stale-while-revalidate | Existing 10-second polling retains content; add request deduplication, invalidation, and truthful freshness state. | 3 |
| 7 | Pre-rendering | Pre-render a public boot shell into HTML. Do not prerender authenticated inventory or background another authenticated page. | 9 |
| 8 | BlurHash placeholders | Generate hashes from actual bundled images and use them while those same assets decode. | 10 |
| 9 | View transitions | Progressive enhancement for pointer-driven page/batch navigation, with cancellation and immediate fallback. | 7 |
| 10 | Swipe-to-dismiss sheets | Apply to the mobile More menu; keep form editing out of swipe dismissal in the initial release. | 8 |
| 11 | Interruptible animations | Replace repeated entry keyframes with retargetable transitions; keep gesture motion directly controllable. | 7, 8 |
| 12 | Predictive back | Native Android animation belongs to the browser/OS; improve the web history and overlay behavior it navigates. Native implementation is conditional on an Android app. | 8, conditional A |
| 13 | Hit slop | Most icon buttons are already 44 px; fix undersized dismiss buttons, text actions, and carousel dots. | 1 |
| 14 | Safe-area insets | Existing top/bottom padding needs landscape left/right and new overlay/toast coverage. | 1, 5, 8 |
| 15 | One-time code autofill | Current sign-in is a reusable four-digit PIN. Implement only when a real OTP verification flow exists. | Conditional B |
| 16 | Tabular numbers | Already enabled on `body`; verify numeric controls and overrides inherit it. | 1 |
| 17 | Balanced headlines | Already enabled for `h1`, `h2`, `h3`; verify long English/Urdu headings and fallback wrapping. | 1 |
| 18 | Continuous corners | Add supported CSS squircle corners to sheets/cards, retaining existing rounded-corner fallback. | 1 |
| 19 | Idempotency keys | Movements already have durable IDs and hashes; extend reliable replay to all inventory JSON write endpoints. | 2 |
| 20 | Amazon safe triangle | There are no nested hover menus today. Apply only if a real submenu is introduced; do not add navigation complexity just to exercise it. | Conditional C |

Items 16 and 17 should not be rebuilt. Items 12, 15, and 20 have explicit platform/product prerequisites and must not be reported as fully shipped in the initial web release.

## Delivery order and file boundaries

Recommended order: **1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 → 11**. Task 1 and the asset/build work are independently reviewable; Tasks 4–5 depend on the data guarantees in Tasks 2–3.

| Area | Existing integration points | New focused units |
| --- | --- | --- |
| UI foundation | `src/yarnflow.css`, `src/fabric-hero.css`, `src/scanner-artwork.css` | No new framework or component hierarchy |
| Durable writes | `src/inventory-client.ts`, `src/LiveApp.tsx`, `server/inventory.mjs`, `tests/inventory-api.test.mjs` | `server/idempotency.mjs`, `drizzle/0002_request_receipts.sql` |
| Workspace data | `src/LiveApp.tsx`, `src/SignIn.tsx`, `src/Team.tsx` | `src/workspace-store.ts`, `src/Skeleton.tsx` |
| Optimistic materials | `src/LiveApp.tsx`, `src/forms.tsx` | `src/catalog-mutations.ts` |
| Notices | `src/LiveApp.tsx` | `src/Toast.tsx` |
| Commands and routes | `src/LiveApp.tsx`, `src/main.tsx`, `src/i18n.tsx` | `src/navigation.ts`, `src/commands.ts`, `src/CommandMenu.tsx` |
| Motion and sheets | `src/yarnflow.css`, `src/LiveApp.tsx` | `src/motion.ts`, `src/Sheet.tsx` |
| Public boot HTML | `index.html`, `package.json`, `scripts/prepare-offline.mjs`, `public/sw.js` | `scripts/prerender-shell.mjs` |
| Image placeholders | `src/ScannerArtwork.tsx`, `src/FabricHero.tsx`, `package.json` | `src/BlurImage.tsx`, `src/image-placeholders.json`, `scripts/generate-image-placeholders.mjs` |

Paths in task sections are relative to `yarn-erp/`. New units should expose only the interfaces specified below; `LiveApp.tsx` remains the integration point rather than absorbing all new logic.

### Task 1: Establish the baseline and finish the UI foundation

**Files:** Modify the three CSS files above only where the audit finds a gap. Add `e2e/interaction-foundation.spec.ts` for actual target/overflow behavior; reuse `e2e/language-layout.spec.ts` for language coverage.

**Interfaces:** CSS tokens `--safe-top`, `--safe-right`, `--safe-bottom`, `--safe-left`, `--motion-fast: 140ms`, `--motion-standard: 220ms`; existing radius/easing tokens remain authoritative.

- [x] Record `git status --short`, then run `npm test`, `npm run build`, and `npm run test:e2e`. Record pre-existing failures separately; the current tree contains ongoing test changes, so do not assume a green baseline.
- [x] Audit sign-in, Home, Stock, batch detail, Scan, History, Team, and Settings at 390, 844 landscape, and 1440 px in both languages. Record the actual undersized targets and clipped regions.
- [x] Fix the measured gaps with real padding/minimum dimensions before using pseudo-element hit slop. Keep dense neighboring actions distinct and visible focus rings unclipped.
- [x] Apply physical safe-area values to the corresponding physical edge, with logical layout properties for content. Use `100dvh` with a `100vh` fallback; avoid double-applying the bottom inset.
- [x] Preserve existing `tabular-nums` and `text-wrap: balance`; check weights, counts, percentages, timestamps, inputs, and long headings. Use `bdi`/`dir="ltr"` for identifiers where needed, not a global direction override.
- [x] Add `@supports (corner-shape: squircle)` for sheet/panel surfaces only. Keep circles, pill buttons, border radii, shadows, and focus outlines intact in the fallback. This is progressive enhancement because support varies. [CSS corner-shape reference](https://developer.mozilla.org/en-US/docs/Web/CSS/Reference/Properties/corner-shape)
- [x] Verify `npx playwright test interaction-foundation.spec.ts language-layout.spec.ts`; inspect the touched screens visually. Do not add unit tests that merely assert CSS text. Commit this task independently when checks pass.

### Task 2: Make retries reliably idempotent before introducing optimism

**Files:** Create `server/idempotency.mjs`, `drizzle/0002_request_receipts.sql`; modify `server/inventory.mjs`, `src/inventory-client.ts`, the inventory/reversal draft code in `src/LiveApp.tsx`, and `tests/inventory-api.test.mjs`. Check the actual migration runner/journal convention before registering the migration; do not rewrite existing migrations.

**Interfaces:** Extend `inventoryRequest<T>(path, data?, signal?, options?: { idempotencyKey?: string }): Promise<T>`. Add `commitIdempotent({ db, workspaceId, actorId, method, path, key, digest, statements, response }): Promise<Response>` in the server helper; `statements` are D1 prepared statements and `response` is `{ status: number; body: object }`.

- [ ] Add API tests named `replays a committed request after response loss`, `rejects changed payload for an existing key`, `concurrent duplicates commit once`, `scopes keys to actor workspace and route`, and `a failed batch leaves no receipt or mutation`. Assert one product/lot/QC event/inspection/movement/reversal, identical returned identifiers, HTTP 409 for a changed committed payload, and intact balances after failure. Exercise each protected route with a table-driven fixture.
- [ ] Run `npm run test:api` and confirm those new tests fail for the identified gaps before implementation.
- [ ] Create a durable receipt keyed by `(workspace_id, actor_id, method, path, request_key)`, storing a canonical request digest, response status/body, and creation time. Retain receipts with the inventory records; do not introduce an expiry that silently permits duplicate old retries.
- [ ] Authenticate and check current route permissions before replaying a receipt. Validate and normalize input before hashing; never include random generated IDs or timestamps in that digest. Commit the receipt and mutation in the same D1 `batch`, whose failure rolls back both. On a duplicate-key race, read and compare the winning receipt rather than reporting a generic stock error.
- [ ] Protect `/products`, `/lots`, `/quality`, `/inspections`, `/movements`, and `/reversals`. Preserve the movement ID/hash and database constraints; strengthen inspection replay to reject a changed payload. Keep compatibility for existing clients without the header, while promising safe retries only for protected requests. Auth, PIN changes, scanner inference, and multipart photo upload are outside this JSON receipt contract.
- [ ] Use one UUID per inventory draft intent. Unchanged retry reuses it; an edit creates a new key; opening a new operation creates a new key. For movements/reversals/inspections, use the same value as the existing operation `id`. Never derive an operation key from a persistent user/lot ID, and never generate a replacement key automatically after a timeout.
- [ ] Distinguish user cancellation, timeout/unknown outcome, validation failure, and auth failure in the client error model. Only protected mutations may offer “Retry safely”; GET failures must not claim that a save failed. Do not automatically retry POST requests in a loop.
- [ ] Run `npm run test:api`, then a local Cloudflare/D1 integration check for transaction rollback and duplicate submission. Inspect a fresh and an existing database migration locally. Commit server/client contract together.

### Task 3: Session-safe stale-while-revalidate and skeleton loading

**Files:** Create `src/workspace-store.ts`, `src/Skeleton.tsx`, `tests/workspace-store.test.ts`; modify `src/LiveApp.tsx`, `src/SignIn.tsx`, `src/Team.tsx`, `src/yarnflow.css`, and `e2e/session-lifecycle.spec.ts`.

**Interfaces:** `createWorkspaceStore(fetcher: (signal: AbortSignal) => Promise<WorkspaceState>)` returns `getSnapshot()`, `subscribe(listener)`, `refresh({ force?: boolean }?)`, `invalidate()`, and `clear()`. Snapshot: `{ data: WorkspaceState | null; status: 'empty' | 'loading' | 'ready' | 'refreshing' | 'offline' | 'error'; verifiedAt: number | null; error: Error | null }`. `SkeletonRows({ label, count })` and `WorkspaceSkeleton({ label })` are presentational, SSR-safe components.

- [ ] Add tests `deduplicates overlapping refreshes`, `keeps stale data when refresh fails`, `a pre-mutation response cannot replace a newer snapshot`, and `clear prevents late responses from repopulating the store`. Assert one shared request, retained data plus an error status, and an empty store after a late response following clear.
- [ ] Run `node --experimental-strip-types --test tests/workspace-store.test.ts` to establish failures, then implement an abortable store with a generation counter. A forced post-write refresh invalidates the older generation; older requests cannot publish data or settle the newer request's status.
- [ ] Bind the store with React's `useSyncExternalStore`. Retain the current 10-second visible polling cadence; deduplicate focus/online/poll refreshes. Clear/abort synchronously when the session locks. Cache isolation must survive signing in as a different person.
- [ ] Show a layout-matched skeleton only with no usable data: opening inventory, loading people, loading Team. A background refresh keeps content, filters, scroll, and focus in place. Skeleton shapes are decorative with one useful status label; reduced motion produces a static placeholder.
- [ ] Replace the unconditional “All changes saved” footer with explicit checking, verified-time, offline, and failed-refresh states. A failed GET never suggests a successful synchronization. Reserve pending-write status for Task 4.
- [ ] Add browser tests that delay `/workspace`, then lock the session before releasing the response; also fail a background GET while Stock is visible. Assert no restored inventory after lock and no blanking of retained stock on network failure.
- [ ] Run the store tests and `npx playwright test session-lifecycle.spec.ts interaction-foundation.spec.ts`; commit after the lifecycle behavior remains intact.

### Task 4: Optimistic material creation with targeted rollback

**Files:** Create `src/catalog-mutations.ts`, `tests/catalog-mutations.test.ts`; modify `src/LiveApp.tsx`, `src/forms.tsx`, and add `e2e/optimistic-materials.spec.ts`.

**Interfaces:** `PendingMaterial = { operationId: string; product: Product; status: 'saving' | 'unconfirmed' }`; `mergePendingMaterials(confirmed: Product[], pending: PendingMaterial[]): Product[]`; `createMaterial({ operationId, values, signal }): Promise<Product>` uses Task 2's key. Pending records are a separate overlay, never authoritative workspace data.

- [ ] Test `pending material appears before the response`, `confirmation replaces rather than duplicates it`, `failure removes only its own overlay`, and `refresh preserves unrelated pending entries`. Use deferred promises and assertions on visible IDs/counts rather than timing sleeps.
- [ ] After the existing review step, show the material immediately in Stock with a visible “Saving…” label. Disable batch creation, command actions, and barcode-dependent operations for that pending entry.
- [ ] On confirmed success, reconcile with the server's returned product and invalidate the workspace snapshot. Remove the draft only after confirmation. Never show a success toast solely because the optimistic row exists.
- [ ] On a definite rejection, remove only that operation's overlay and restore its editable draft with the error. On timeout/unknown outcome, mark it unconfirmed and offer retry with the same key. Do not resurrect the user's whole old snapshot or discard unrelated changes.
- [ ] On sign-out, clear overlays and suppress completion callbacks from that session. Keep existing local preferences immediate; keep all stock, QC, evidence, and permission writes server-confirmed.
- [ ] Run unit tests plus `npx playwright test optimistic-materials.spec.ts inventory.spec.ts session-lifecycle.spec.ts`. Verify delayed success, HTTP 409, offline failure, lost-response retry, and sign-out during save. Commit independently.

### Task 5: Accessible Undo toasts that preserve the ledger

**Files:** Create `src/Toast.tsx`, `e2e/undo-toast.spec.ts`; modify `src/LiveApp.tsx` and `src/yarnflow.css`.

**Interfaces:** `Toast({ id, message, action?: { label, onAction }, onDismiss })`; the caller owns the notification lifecycle. The Undo action carries the confirmed movement ID and uses the existing reversal form.

- [ ] Add tests `Undo opens review with the original movement`, `Undo stays available while navigating`, `consumed stock rejects reversal without deleting history`, and `a permission change removes the Undo action`. Assert that no reversal is sent until its existing review/save step is completed.
- [ ] Move global save notices to one fixed, safe-area-aware region above mobile navigation. Announce each message once through a polite live region; never steal focus. Keep action and dismiss targets at least 44 px.
- [ ] Informational notices expire after 6 seconds of active visible reading time, paused on hover/focus. Actionable Undo and error notices remain until handled or dismissed. The next confirmed operation may replace the prior notice; the prior movement remains reversible through History.
- [ ] Preserve notices across ordinary page navigation; clear them on session lock. Open Undo from its confirmed record, even if the latest snapshot refresh is delayed. Fetch the record if unavailable rather than silently doing nothing.
- [ ] Use interruptible transform/opacity transitions, immediate keyboard behavior, and a reduced-motion fallback. Refresh failure after a successful write must distinguish “saved” from “could not refresh current stock.”
- [ ] Run `npx playwright test undo-toast.spec.ts inventory.spec.ts session-lifecycle.spec.ts`. Verify on narrow Urdu layout and at 200% zoom. Commit after reversal semantics remain unchanged.

### Task 6: Command menu, shortcut hints, and coherent navigation

**Files:** Create `src/navigation.ts`, `src/commands.ts`, `src/CommandMenu.tsx`, `tests/navigation.test.ts`, `tests/commands.test.ts`, `e2e/command-menu.spec.ts`; modify `src/LiveApp.tsx`, `src/yarnflow.css`, and translations used by new copy.

**Interfaces:** `AppRoute = { page: Page; lotId?: string; view?: 'all' | 'quality' | 'production' | 'dispatch' }`; `parseRoute(hash): AppRoute`; `serializeRoute(route): string`; `navigate(route, { replace?: boolean }?): void`. `Command = { id: string; label: string; keywords: string[]; group: 'pages' | 'batches' | 'actions'; run: () => void }`; `buildCommands(state, context): Command[]`. `CommandMenu({ open, commands, onClose })` uses a native dialog and an input/listbox pattern.

- [ ] Test existing deep links and aliases, encoded batch identifiers, unknown-route fallback, and Back/Forward round trips. Retain `#/overview`, `#/inventory`, `#/inventory/:id`, and legacy aliases; optionally encode a non-default Stock view in the hash query without breaking existing links.
- [ ] Centralize route updates so URL changes, React state, selected lot, and form opening cannot race. In particular, a command that navigates then opens a form must not have the form cleared by a later `hashchange` effect. Avoid duplicate history entries for the current destination.
- [ ] Build commands from confirmed current-session data. Include allowed pages, batch/material/SKU search, and permitted New material/New batch/selected-batch actions. Recheck permission when an action runs; omit unavailable/pending targets. Keep the palette flat and grouped.
- [ ] Add a visible desktop trigger and a mobile More-menu entry. `Cmd/Ctrl+K` toggles it; Arrow keys change the active result, Enter runs it, Escape closes it. Ignore composing events and unrelated shortcuts; do not replace normal typing, browser Back, or find-in-page.
- [ ] Keep input focus while moving results, expose `aria-controls`/`aria-activedescendant`, scroll the selected result into view, announce result count, and restore focus on close. When navigating, focus the destination heading instead of a removed trigger.
- [ ] Show keyboard hints using `<kbd>` and `aria-keyshortcuts`, with platform-appropriate modifier display. New labels have English/Urdu pairs; shortcut tokens remain LTR. Opening/closing from the keyboard has no animation.
- [ ] Run the two new unit suites plus `npx playwright test command-menu.spec.ts language-layout.spec.ts`. Test no matches, long lists, stale permissions, rapid repeated opening, editable fields, and keyboard-only operation. Commit routing and command integration together.

### Task 7: Interruptible motion and progressive view transitions

**Files:** Create `src/motion.ts`, `e2e/motion-navigation.spec.ts`; modify `src/main.tsx`, `src/navigation.ts`, and the three relevant CSS files.

**Interfaces:** `transitionView(update: () => void, origin: 'pointer' | 'keyboard' | 'history'): void`; `cancelViewTransition(): void`. Input origin is passed explicitly by navigation callers, not inferred from a stale last-key flag.

- [ ] Add browser tests `rapid navigation ends on the latest destination`, `keyboard and reduced motion navigate immediately`, `missing view transition support still navigates`, and `locking cancels any captured inventory frame`.
- [ ] Audit the existing 320–560 ms entry keyframes and stagger delays. Remove repeated page/list entrance animation; use CSS transitions for changing state. Keep functional transitions at 140–220 ms and gesture settling at no more than 260 ms. No animation delays may block interaction.
- [ ] Feature-detect `document.startViewTransition` for pointer page/batch navigation only. Flush the React update inside its callback; skip an older transition when a newer navigation starts and guard stale callbacks so old routes cannot win. Keep the sidebar/nav stable rather than crossfading the entire application. Unsupported browsers run the same update immediately. [View Transition API](https://developer.mozilla.org/en-US/docs/Web/API/Document/startViewTransition)
- [ ] Skip transitions for commands, browser history, scanner capture, authentication, permission changes, and financial/stock confirmations. Cancel transitions before clearing a session so snapshots cannot linger after lock.
- [ ] Preserve reduced-motion behavior across all imported CSS, including scanner artwork. Keep decoration separate from functional state transitions; remove continuous motion if it competes with reading results.
- [ ] Run `npx playwright test motion-navigation.spec.ts command-menu.spec.ts session-lifecycle.spec.ts`; inspect rapid navigation under CPU throttling. Commit independently.

### Task 8: Mobile sheets and browser Back that do what users expect

**Files:** Create `src/Sheet.tsx`, `e2e/sheets-history.spec.ts`; modify `src/LiveApp.tsx`, `src/navigation.ts`, and `src/yarnflow.css`.

**Interfaces:** `Sheet({ open, label, children, onDismiss })`; `openOverlay(id: 'navigation' | 'commands' | 'form', payload?): void`; `closeOverlay(): void` in the navigation module. Overlay descriptors store identifiers only, never PINs, scan payloads, or form contents in history.

- [ ] Add tests `dragging the grip dismisses`, `scrolling sheet content does not dismiss`, `pointercancel restores the open sheet`, `Back closes the top overlay before leaving the page`, and `closing an overlay does not add a ghost history entry`.
- [ ] Convert the existing mobile More dialog into a bottom sheet with a clear grip and close button. Use native dialog focus trapping/Escape, restore focus, prevent background scrolling, and constrain height to the visible viewport with safe-area padding.
- [ ] Capture one primary pointer on the grip. Update only the sheet transform while dragging; ignore extra pointers. Dismiss after 100 px downward travel or a downward velocity over 0.5 px/ms with at least 24 px travel, measured over the recent movement window. Otherwise settle back; damp upward overscroll. Cancel/lost-capture never dismisses.
- [ ] Make re-grabbing during settling continue from the current visual offset. Do not attach pan handlers to the entire document or content list. Keep a non-gesture close action available at all times.
- [ ] Integrate overlay ownership with `history.state` and `popstate`: Back closes the top overlay; explicit close consumes only its owned entry; navigation replaces an active transient overlay entry rather than leaving an empty stop. Preserve route aliases, direct links, and meaningful Forward behavior.
- [ ] Keep draft fields in the existing scoped draft store. Browser Back may leave a draft recoverable, but do not introduce swipe dismissal for saving/review forms. Never intercept the browser's edge swipe or simulate Android's system preview with a screenshot.
- [ ] Run `npx playwright test sheets-history.spec.ts command-menu.spec.ts session-lifecycle.spec.ts` on both projects. Manually verify on an iPhone in Safari and installed mode, including landscape, keyboard, VoiceOver, slow drag, fast flick, and interrupted drag. Commit after gesture and history checks pass.

### Task 9: Pre-render the public shell and make static caching useful

**Files:** Create `scripts/prerender-shell.mjs`, `tests/prerender-shell.test.mjs`; modify `src/Skeleton.tsx`, `index.html`, `package.json`, `scripts/prepare-offline.mjs`, and `public/sw.js`.

**Interfaces:** Build script renders `WorkspaceSkeleton` to static HTML without browser globals, credentials, or API calls; replaces only an explicit root marker in the built `dist/index.html`.

- [ ] Add a build-artifact check asserting meaningful public boot markup and a no-JavaScript message, with no people, stock, tokens, or fabricated statistics. Assert the boot layout survives blocked JavaScript and has reserved dimensions.
- [ ] Run prerendering after Vite emits CSS/assets and before offline preparation/worker bundling. Apply the same sequence to both `build` and `deploy:cloudflare` so production cannot skip it.
- [ ] Keep `createRoot` replacement for the public shell; do not hydrate the current browser-dependent `LiveApp` or introduce a second competing loading tree. Include a useful failure/reload state if app startup fails.
- [ ] Keep HTML network-first with cached public-shell fallback. Serve content-hashed static assets cache-first; allow stale-while-revalidate only for appropriate same-origin public static resources. Never cache `/api/*`, auth responses, or requests explicitly marked `no-store`.
- [ ] Version the shell cache from the emitted HTML as well as asset paths, and clean obsolete caches without breaking a still-open older client. Do not indiscriminately delete old hashed assets on activation; retain the immediately previous shell version for existing clients.
- [ ] Run `npm run build` and the artifact test. Use a dedicated service-worker-enabled browser test for first load, reload, offline shell, and an upgrade with an older tab open; the usual e2e tests block service workers. Commit only after both build paths produce the same boot shell.

### Task 10: Actual BlurHash placeholders with stable image geometry

**Files:** Create `src/BlurImage.tsx`, `src/image-placeholders.json`, `scripts/generate-image-placeholders.mjs`, `tests/image-placeholders.test.mjs`, `e2e/image-loading.spec.ts`; modify `src/FabricHero.tsx`, `src/ScannerArtwork.tsx`, their CSS, and `package.json`/lockfile.

**Interfaces:** `BlurImage({ src, hash, alt, width, height, loading, className })`; manifest keys correspond to the existing fabric/artwork asset identifiers. Use the reference `blurhash` encoder/decoder, with `sharp` as a build-only dependency if needed for WebP decoding.

- [ ] Generate deterministic 4 × 3-component hashes from small, alpha-composited copies of the actual bundled source images; use each target surface's real background for transparent art. Decode at about 32 px and scale in CSS. Include source content digests so verification detects stale placeholders. [BlurHash reference implementation](https://github.com/woltapp/blurhash)
- [ ] Validate every used manifest entry: matching source digest, decodable hash, nonzero dimensions. Do not handwrite generic hashes or create placeholder images that imply a scan result.
- [ ] Reserve image width/height or aspect ratio before loading. Show the hash until the corresponding image has loaded and decoded, then crossfade in 140 ms. Cached images should skip unnecessary placeholder flashing; changed `src` resets state; failed images keep a neutral fallback and correct alternative text.
- [ ] Apply first to bundled fabric hero and scanner artwork assets only. Keep capture photos/evidence unchanged until a real upload pipeline can supply trustworthy dimensions and hashes. Above-fold hero imagery loads eagerly; secondary images load lazily.
- [ ] Keep the decoding canvas decorative and avoid duplicate accessible names. Preserve transparent edges, existing crop/fit behavior, and RTL layout. Reduced motion swaps immediately.
- [ ] Run `npm run build`, the manifest test, and `npx playwright test image-loading.spec.ts scanner-artwork.spec.ts`. Delay and fail image responses, switch images rapidly, and confirm no layout shift or stale-image flash. Record the runtime bundle increase; target less than 10 KB gzip for placeholder code plus manifest. Commit independently.

### Task 11: Integrated acceptance and handoff

**Files:** Update `docs/DECISIONS.md` and the relevant existing e2e files only for changed intended behavior; store before/after captures under a new `docs/progress/interaction-quality/` directory during implementation.

- [ ] Run `npm test`, `npm run build`, and `npm run test:e2e` once the final integrated code is ready. Investigate new failures and clearly separate any unchanged baseline failures; do not weaken tests to make them green.
- [ ] Perform one end-to-end scenario: sign in → command-search a batch → receive stock → lose the response → retry → observe one entry → Undo via reviewed reversal → verify original and reversal remain → background the app → require PIN again.
- [ ] Check desktop keyboard, phone touch, English, Urdu, reduced motion, offline, delayed responses, 200% zoom, and screen-reader dialog announcements. Run axe on the command menu and sheet in addition to the existing app checks.
- [ ] Measure the agreed budgets under the same throttling before/after: no intentional keyboard-command delay; input feedback within 100 ms; no blocking route animation; initial sign-in/app-shell CLS ≤ 0.1; no layout shift caused by loaded images; no duplicate stock side effects.
- [ ] Verify a physical iPhone and Android browser for edge Back, browser chrome, safe areas, and installed-mode behavior. Playwright device emulation alone is not evidence of native predictive-back support.
- [ ] Document what shipped, what was already present, and which conditional features remain unavailable. Record commands, screenshots, performance conditions, and unresolved failures. Final completion claims must follow evidence, not the presence of a component file.

## Conditional work: explicit prerequisites rather than unused scaffolding

### A. Native predictive back — item 12

The current repository has no Android app to integrate. The browser/OS owns its predictive-back animation; the web deliverable is Task 8's correct history and overlay behavior. If an Android client is later introduced, create a separate native plan using Android's supported back APIs, with gesture-progress, cancellation, unsaved forms, nested navigation, and accessibility tests on a real device. Do not intercept edge gestures with a web drag handler. [Android predictive-back guidance](https://developer.android.com/guide/navigation/custom-back/predictive-back-gesture)

### B. One-time-code autofill — item 15

`src/SignIn.tsx` currently accepts a reusable four-digit PIN, so adding `autocomplete="one-time-code"` there would misdescribe the credential. When a genuine code-verification endpoint and delivery flow exist, add a single semantic input with `autocomplete="one-time-code"`, suitable `inputmode`, paste/autofill handling, and accessible error/retry states. Code length and expiry must come from that authentication contract, not this UI plan. Test manual typing, full-code paste, OS autofill, expiry, and duplicate submission; preserve the existing PIN flow. [Autocomplete token semantics](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete)

### C. Amazon safe triangle — item 20

Keep the initial command menu flat and the existing navigation direct. If a nested desktop hover menu becomes a real product requirement, add a submenu component with pointer-intent geometry: a triangle from the last pointer location to the near-edge submenu corners delays sibling activation while the pointer travels toward the submenu. Use actual panel bounds, including flipped RTL placement; cap the deferral at 300 ms and cancel on outside movement, scrolling, or close. Keyboard and touch open/close explicitly without hover delays. Acceptance must cover diagonal travel through sibling rows, leaving the corridor, layout changes, Escape, Arrow navigation, and coarse pointers. No unused geometry helper or extra hover UI ships in this release.

## Completion boundary

The initial web implementation is complete when Tasks 1–11 pass their acceptance checks, existing session/stock rules remain intact, and each requested item has an honest status. Native predictive back, OTP autofill, and safe-triangle menus remain conditional until their prerequisites exist. Producing this plan does not authorize beginning those additional product/platform projects.
