# Yarnflow

A stock and quality workspace for yarn inventory, with a PIN login and a visual dashboard. Inventory is stored in the browser on each device. Use Settings to download a backup and restore it when moving devices. The PIN controls access in this browser; it does not encrypt inventory.

## Run locally

```sh
npm install
npm run dev
```

Open `http://localhost:5174`. On first use, create a four-digit PIN. Later visits ask for that PIN.

## Inventory workflows

Create materials and batches, receive stock, transfer between stages, approve or hold batches after inspection, dispatch approved stock, and reverse movements with a reason. The dashboard, stock register, reports, and activity history update from those entries. Stock balances are checked before dispatch or reversal.

Use **Settings → Download backup** regularly. **Restore backup** replaces the records in this browser. **Clear inventory** removes all inventory records from this browser after confirmation.

## TexPilot scanner

Open **Material scanner → Fabric inspection → Model connection** and enter the TexPilot API base URL, or set `VITE_SCANNER_API_URL` when building. The scanner uses `GET /api/v1/model` and `POST /api/v1/scan`; the yarn-spec scan uses `POST /api/v1/spec`. A published HTTPS app needs an HTTPS scanner URL. Barcode lookup and manual inspection work without model inference.

## Verify

```sh
npm test
npm run build
node .qa/mvp-check.mjs
node .qa/mvp-flow.mjs
node .qa/mvp-offline-backup.mjs
```
