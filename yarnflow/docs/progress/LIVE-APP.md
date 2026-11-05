# Shared inventory implementation — 24 October 2026

## Delivered behavior

The default app uses authenticated, workspace-scoped server APIs and SQL persistence rather than device-local stock. Materials/SKUs, dye lots, stage balances, receipts, transfers, dispatch, waste, immutable reversals, QC decisions and inspection evidence are persisted. Photos are stored separately in R2 with authorized retrieval. The original bilingual practice workspace is preserved at `/?practice=1` with independent sample data.

Stock is represented as integer grams, cartons and cones. Atomic SQL batches and nonnegative balance constraints protect concurrent writes. Repeated movement IDs are idempotent only when their payload matches. Actors come from server identity, not client-supplied author fields. An uninspected or held lot cannot be dispatched. Only an owner can approve QC, export data or issue a single-use 72-hour workspace invite.

The phone barcode reader uses a real decoder and actual QR label images; it supports manual entry and photo decoding when live camera access is unavailable. Every batch has a persistent hash route and printable QR label. Inspection uploads are checked for format/size, stored privately, and do not automatically release QC.

## Verification

- 31 Node unit/API/domain tests pass, including cross-workspace authorization, CSRF rejection, concurrent stock limits, exact transfer conservation, immutable reversal, retry idempotency, QC approval roles, photo privacy and upload validation.
- Evidence-retention regression seeds 1,050 newer records on another batch and verifies the original batch remains queryable and all 1,051 inspection/QC records and 1,050 photo metadata records export across pages.
- Seven browser cases run on desktop Chromium and iPhone WebKit: stock workflow, second-phone invitation/lookup, real QR-photo decode, failed-save/offline draft behavior, inspection photo save/reopen, accessibility/overflow checks on five routes, and independent history when changing batch routes.
- Scoped accessibility checks found no WCAG A/AA violations on those five shared app routes at the tested desktop/iPhone sizes. This is not a universal accessibility certification.
- Desktop/phone captures are in `docs/progress/live/`.
- The Impeccable detector ran once on the new UI files and returned no findings. Independent finish review closed the selected-batch history/export retention defects and returned ship for its scoped review.
- TypeScript and production Worker builds pass. The production publishing workflow repeats the source-bound build and required checks before packaging.

## Hosting and dependencies

The existing Site project ID is preserved. Its source manifest now declares a Worker with `DB` and `BUCKET`; no public audience change was made. Sites supplies authenticated identity and provisions D1/R2. The Node/SQLite server is loopback-only development infrastructure with explicit emulated identity and is not shipped as hosted authentication.

The hosting artifact contains the compiled frontend and API in one Worker bundle, with a static asset map. No model weights or service secrets are included. API responses bypass service-worker caching. The offline shell does not turn disconnected writes into successful shared saves.

## Explicit limits

- The hosted inventory backend is Yarnflow's ledger, not an installed or synchronized InvenTree/ERPNext/Odoo service.
- Optional InvenTree 1.6.1 deployment files are preserved from a pinned upstream release. Its containers were not run because Docker's daemon was unavailable. The API connection check checks connectivity only.
- This project's trained TexPilot bundle is still missing. No real-model inference was claimed or substituted. Barcode/manual inspection is functional independently.
- Actual iPhone camera permissions/focus, Home Screen auth sessions and printer output require physical-device acceptance; WebKit emulation does not certify them.
- JSON export covers structured records and photo metadata, not photo bytes or an automatic restore. Full recovery needs a coordinated database/object-storage backup and a tested restore.
- The new shared app is an English testing workspace; the prior bilingual practice interface remains available separately.

Repository comparisons and setup instructions: `docs/BACKEND-OPTIONS.md`, `docs/IPHONE-SETUP.md`, `deploy/inventree/README.md`.
