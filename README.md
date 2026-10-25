# Yarnflow MVP

A frontend inventory workspace for tomorrow's demo. Inventory records live in the browser on each device. The default dashboard opens with clearly marked sample materials, batches and stock movements so the interface can be explored immediately. The TexPilot material scanner remains a separate service connection.

## Run locally

```sh
npm ci
npm run dev -- --port 5174
```

Open `http://localhost:5174`. On first use, create a four-digit PIN. Later visits ask for that PIN. Use **Settings → Start with empty inventory** before entering real factory stock. The PIN is a convenience lock for this browser; inventory is not encrypted and does not sync to other devices.

For a production build:

```sh
npm run build
npm run preview
```

## What works without an inventory backend

- Add materials and batches; receive, transfer, dispatch and waste stock.
- Record quality decisions and manual or scanner-linked inspection notes.
- Validate quantities against available stock, preserve movement history and reverse mistakes.
- Search by batch, SKU or barcode; generate a printable batch QR label.
- Work offline for inventory. Records and drafts persist in this browser.
- Download a JSON backup and restore it in **Settings**. Do this after each working day and before clearing browser data or changing devices.

Sample batches start with `DEMO-`. Clearing sample inventory is explicit and replaces the local sample records. Keep a backup before restoring or clearing records. Inspection photos and multi-device inventory sharing require a future storage service and are not offered by this frontend MVP.

## TexPilot scanner

Open **Material scanner → Fabric inspection → Model connection** and enter the existing TexPilot API base URL, or set `VITE_SCANNER_API_URL` when building. The scanner uses `GET /api/v1/model` and `POST /api/v1/scan`; the yarn-spec scan uses `POST /api/v1/spec`. A published HTTPS app needs an HTTPS scanner URL. The scanner backend and trained model must be running for live predictions. Barcode lookup and manual inspection work without model inference.

## Verification

```sh
npm run typecheck
npm run build
node .qa/mvp-check.mjs
node .qa/mvp-flow.mjs
node .qa/mvp-offline-backup.mjs
```

The browser checks cover PIN setup and rejection, desktop and phone layouts, material/batch creation, stock receipt and dispatch, quality review, reload persistence, offline saves, and backup/restore.

The older server-backed inventory implementation remains in `server/` for later integration. The current frontend does not call it for inventory.
