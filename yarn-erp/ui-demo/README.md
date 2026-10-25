# Yarnflow UI concept

An isolated, interactive design preview. The existing shared app, scanner, ledger,
and theme are untouched. This concept has no inventory API client and stores no
records beyond the current page session.

From `yarn-erp/`:

```sh
npm run dev -- --port 5174
# Open http://localhost:5174/ui-demo/
npx tsc -p ui-demo/tsconfig.json
npx vite build --config ui-demo/vite.config.ts
```

Use **Website / Mobile app** in the preview bar to compare layouts. Open
`/ui-demo/?embedded=1` on a phone to see the mobile layout without the presentation
bar. This is a mobile UI prototype, not a compiled iOS or Android application.

## Included interactions

- Overview with week/month chart, stock-stage distribution, and QC attention.
- Inventory search, QC filters, empty results, batch detail drawer, and CSV export.
- A temporary sample stock receipt that updates totals, QC counts, stage
  distribution, and the activity list. Refresh clears added receipts.
- Fabric inspection simulation with loading, consistent, needs-review, and
  insufficient-evidence results. Stock-label lookup opens a sample batch.
- Mobile bottom navigation and a mobile batch list showing quantities and QC
  together without horizontal scrolling. Desktop uses an inventory table.
- Escape to close dialogs, native dialog focus containment, keyboard focus rings,
  reduced motion, and Cmd/Ctrl+K for inventory search.

## Asset origins

- Inspiration: Opedia Studio's Vault warehouse dashboard case study, supplied by
  the user: https://dribbble.com/shots/26063241-Warehouse-Management-Dashboard-UI-Design-Inventory
  The case-study images are references only; none are embedded in the demo.
- Manrope font files: Google Fonts (`fonts.gstatic.com`), distributed under the
  bundled `assets/OFL.txt` license.
- Fabric/garment thumbnails: existing project assets in `src/assets/fabrics/`.
- Interface icons: the existing project's `lucide-react` package.

Build output is in `ui-demo/dist/`, separate from the production build. The design
awaits user review; no production theme or deployment has been changed.
