# Yarnflow

The factory app for yarn and fabric stock, production, quality, sales and dispatch. Everyone signs
in with a name and a 4-digit PIN; data lives in the shared Cloudflare D1 database `yarnflow-db`.
English and Urdu, phone and desktop.

## Run locally

```sh
npm install
npm run dev
```

Open the local URL printed by Vite and sign in.

## What is in it

- **Stock:** materials, batches, receiving, stage transfers, holds, dispatch and reversals with a
  reason. Balances are checked before dispatch or reversal.
- **Quality:** incoming-fabric QC wizard (a supervisor checks every result), batch inspections.
- **Buying and selling:** price requests to suppliers, purchase orders, sales orders, invoices,
  buyer and supplier portals, shipment tracking.
- **Scan:** one photo of a garment or fabric, optionally its care label. Shows the garment, fabric,
  composition (from the label, or the photo model's group when it is confident; otherwise "Can't
  tell from the photo. Scan the care label."), finish, and the fabric fault check with its heat map.
- **Team:** roles, permissions, chat, notifications.

Design rules are in [`DESIGN.md`](DESIGN.md) ("Denim": white cards, one deep indigo, status colour
only with an icon and a word). Product scope is in [`PRODUCT.md`](PRODUCT.md).

## TexPilot scanner

With the scanner running at `http://127.0.0.1:8000`, `npm run dev` forwards scanner requests to it.
Change the target with `TEXPILOT_API_URL=http://127.0.0.1:PORT`. The published app reaches the
scanner through the Worker secret `TEXPILOT_API_URL` (see `../scanner/deployment/README.md`).
Endpoints: `GET /api/v1/model`, `POST /api/v1/scan`, `POST /api/v1/spec` (yarn count).

## Verify and deploy

```sh
npm test               # unit tests
npm run test:e2e       # Playwright, builds against dist/: run npm run build first
npm run build
npm run deploy:cloudflare
```

Never write test entries to the live ledger.
