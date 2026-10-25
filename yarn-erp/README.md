# Yarnflow

A stock and quality workspace for yarn inventory, with a visual dashboard. Inventory is stored in the browser on each device. Use Settings to download a backup and restore it when moving devices.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite. The dashboard opens directly.

## Inventory workflows

Create materials and batches, receive stock, transfer between stages, approve or hold batches after inspection, dispatch approved stock, and reverse movements with a reason. The dashboard, stock register, reports, and activity history update from those entries. Stock balances are checked before dispatch or reversal.

Use **Settings → Download backup** regularly. **Restore backup** replaces the records in this browser. **Clear inventory** removes all inventory records from this browser after confirmation.

## TexPilot scanner

When TexPilot runs on the same laptop at `http://127.0.0.1:8000`, `npm run dev` forwards scanner requests to it automatically. Open **Material scanner → Fabric inspection** and check that the model is connected. For a different local port, start the app with `TEXPILOT_API_URL=http://127.0.0.1:PORT npm run dev`. Scan results use the generated outcome images included in this repository.

The scanner uses `GET /api/v1/model` and `POST /api/v1/scan`; the yarn-spec scan uses `POST /api/v1/spec`. A published HTTPS app needs an HTTPS scanner URL entered under **Model connection**. Barcode lookup and manual inspection work without model inference.

## Verify

```sh
npm test
npm run build
```
