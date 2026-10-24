# Yarnflow — factory workspace

A responsive, bilingual liquid-glass UI built from the attached yarn ERP kit. This is an interactive practice workspace with realistic sample data and local persistence, not a production factory system.

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

Material scanner (camera/upload and TexPilot inference API), overview, login, quick actions, production, inventory (four stock stages and matrix), orders, dispatch, register view (lot sheet / production / summary), reports, search, day close, save status, settings, help, masters, people/devices, CSV import preview, component gallery, entry details, lot timeline and confirmation flows.

Entry forms autosave per transaction type, require review before saving, and update stock from immutable integer-gram ledger movements. Reversal preserves the original. CSV download, browser printing, search, filters, new orders, themes, Urdu RTL, local day close and draft restoration work. Read-only previews and server-dependent functionality are explicitly labelled.

The original supplied documents are retained under `specification/` as reference material. Implementation boundaries and production prerequisites are in `docs/DECISIONS.md` and `docs/OPEN-QUESTIONS.md`.

## Checks

`npm test` runs Node's built-in test runner against real ledger invariants and edge cases A03, B01, B03, B05, B06, C05 and D02. Browser QA is recorded in `docs/progress/SCREEN-BUILD.md`. The developer-only `.qa/audit.html` harness runs axe in a real iframe at selected widths; it is not included in the production bundle.

## Material scanner

Open `/#/scanner` or choose **Material scanner** in the sidebar. Capture a fabric/garment and optionally a care label, or upload JPEG/PNG/WebP. Enter the existing TexPilot server base URL under **Model connection**. Requests use the exact main-branch multipart `POST /api/v1/scan` contract. A readiness check uses the added `/api/v1/model` route; older servers fall back to `/health`, then verify the model version on the scan itself. Stub responses are rejected.

The hosted HTTPS site requires an HTTPS inference server. `VITE_SCANNER_API_URL` may set its default URL at build time; no API keys belong in this browser setting. For local HTTP development, run the local Yarnflow app and the model API on localhost. The Python server launcher, CORS settings, and readiness endpoint live in the parent TexPilot repository. See `docs/MODEL-CONNECTION.md` for startup and `docs/MODEL-LOCATION.md` for the current missing-artifact investigation.
