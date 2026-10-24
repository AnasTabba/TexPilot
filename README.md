# Yarnflow — factory workspace

The default app now uses a shared server-side stock ledger with durable Cloudflare D1 records and R2 inspection photos. It includes materials/SKUs, dye lots, receipt/transfer/dispatch/waste, owner QC approval, immutable reversals, single-use operator invites, barcode/QR lookup, and an iPhone Home Screen manifest. It starts empty; sample balances are never imported automatically.

- [iPhone setup, friend access and testing guide](docs/IPHONE-SETUP.md)
- [Five GitHub backend candidates, verified stars and maintenance](docs/BACKEND-OPTIONS.md)
- [Optional pinned InvenTree deployment](deploy/inventree/README.md)

The hosted backend is Yarnflow's own ledger, not a deployed upstream ERP. InvenTree is recommended for a later backend choice; the current connection check does not synchronize stock. AI fabric analysis still requires the absent trained TexPilot model bundle and an HTTPS inference service. Barcode scanning, manual inspections and shared stock operate independently of that model.

## Shared app development

```sh
npm ci
npm run build
npm run preview
```

Open `http://127.0.0.1:8788`. This explicitly emulates identity for loopback-only development and uses `.local/inventory.sqlite` plus `.local/photos/`. Production identity comes from the private Sites host; the local preview is not a production login server. For hot reload, run `npm run api:dev` and `npm run dev -- --port 5174` in separate terminals.

```sh
npm test
npx playwright install chromium webkit
npm run test:e2e
```

The same API/SQL runs on D1 and the local SQLite adapter. Tests exercise authorization, cross-workspace isolation, atomic stock constraints, idempotent retries, transfers, QC, reversal history, and photo isolation. Browser tests cover desktop Chromium and iPhone WebKit workflows, real QR-photo decoding and accessibility. Physical iPhone camera and trained-model inference remain separate acceptance checks.

## Separate practice interface

The previous responsive bilingual workspace remains at `/?practice=1`. It uses realistic sample data and browser-local persistence and does not affect the shared stock ledger. The remaining sections describe that separate interface.

## Run

Requires Node.js 24+.

```sh
npm install
npm run dev -- --port 5174
npm run typecheck
npm test
npm run build
```

The default screen is `/#/overview`. The PIN login is `/#/login` (practice PIN **1234**). The profile control also opens login.

## Screens

Material scanner (camera/upload and TexPilot inference API), Today, sign in, stock movement actions, production, stock (four stock stages and matrix), orders, dispatch, register view (lot sheet / production / summary), reports, search, day close, save status, settings, help, masters, people/devices, CSV import preview, component gallery, entry details, lot timeline and confirmation flows.

Entry forms autosave per transaction type, require review before saving, and update stock from immutable integer-gram ledger movements. Reversal preserves the original. CSV download, browser printing, search, filters, new orders, themes, Urdu RTL, local day close and draft restoration work. Read-only previews and server-dependent functionality are explicitly labelled.

The original supplied documents are retained under `specification/` as reference material. Implementation boundaries and production prerequisites are in `docs/DECISIONS.md` and `docs/OPEN-QUESTIONS.md`.

## Checks

`npm test` runs Node's built-in test runner against real ledger invariants and edge cases A03, B01, B03, B05, B06, C05 and D02. Browser QA is recorded in `docs/progress/SCREEN-BUILD.md`. The developer-only `.qa/audit.html` harness runs axe in a real iframe at selected widths; it is not included in the production bundle.

## Material scanner

Open `/#/scanner` or choose **More → Scan material**. Capture a fabric/garment and optionally a care label, or upload JPEG/PNG/WebP. Enter the existing TexPilot server base URL under **Model connection**. Requests use the exact main-branch multipart `POST /api/v1/scan` contract. A readiness check uses the added `/api/v1/model` route; older servers fall back to `/health`, then verify the model version on the scan itself. Stub responses are rejected.

The hosted HTTPS site requires an HTTPS inference server. `VITE_SCANNER_API_URL` may set its default URL at build time; no API keys belong in this browser setting. For local HTTP development, run the local Yarnflow app and the model API on localhost. The Python server launcher, CORS settings, and readiness endpoint live in the parent TexPilot repository. See `docs/MODEL-CONNECTION.md` for startup and `docs/MODEL-LOCATION.md` for the current missing-artifact investigation.

## UI and accessibility

The shared working styles are in `src/workspace.css`. English and Urdu UI text is centralized in `src/ui-copy.ts`; the existing language switch sets document direction and language. The seven-item desktop navigation becomes five labelled bottom tabs on smaller screens. **More** contains the scanner, reports, settings, help, and less frequent tasks.

Stock movements use three steps: date/shift/machine/lot, quantities, and review. Drafts persist per user and movement type. New entries start with empty quantities, today's Karachi date, the current shift, and the last-used machine. Saving reports the exact register values and offers another entry, Done, and Undo. Stock commits require a successful local write; a storage failure keeps typed draft values visible. Orders also persist a draft and require review.

Practice mode stays visible throughout the workspace. The real-workspace control explains that no factory backend is connected; it does not switch local sample data into a live mode. Local saves and offline status remain in one fixed place.

With the dev server running on port 5174, browser checks can be repeated with:

```sh
node .qa/redesign-check.mjs
node .qa/redesign-workflow.mjs
```

These use Playwright Chromium (install with `npx playwright install chromium` if needed), or `PLAYWRIGHT_CHROMIUM_EXECUTABLE`. Results and screenshots are in `docs/progress/redesign/`. See `docs/progress/REDESIGN.md` for coverage and limits.

## Visual design

Shared product tokens in `src/workspace.css` define Yarnflow violet, off-white pages, white card surfaces, status colors, input borders, radii and shadows. Typography retains the accessible sizes from the previous pass, with headings/figures at weight 600, navigation/buttons at 500, and body copy at 400.

To check all routes, forms, and detail views at desktop/tablet/phone widths (plus Urdu and dark mode), run `node .qa/polish-check.mjs` with the dev server running. Screenshots and audit output are saved under `docs/progress/polish/`. `node .qa/polish-history-check.mjs` verifies that dated production entries and reversals drive the weekly chart. See `docs/progress/POLISH.md` for the visual review and the missing historical-data finding.
