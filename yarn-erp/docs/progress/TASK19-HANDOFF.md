# Task 19 handoff: Purchase Manager screens

## Delivered

- `PurchaseScreens` is exported with the agreed `{ member, section, tab, id, navigate }` props. It covers the PM dashboard, supplier directory/review/profile/rating, RFQs and bid comparison, pending awards, purchase orders, B/L tracking, QC-lot arrivals, read-only claims and purchase analytics.
- PM fallback routes in `LiveApp` render with the current member. The fallback preserves the admin member on purchase module hashes while ModuleViews is pending. Supplier route matching now distinguishes `#/supplier` from the factory `#/suppliers` route.
- All purchase forms retain `InterventionField`; errors, validation, empty/loading states and configured-provider errors are surfaced. Amounts use the stored response currency.
- The adapted arrival panel creates QC lots and notifies inspectors without adding stock. Legacy inbound/receipt endpoints return 410 and do not mutate historical receipt rows. The prior common supplier category, RFQ summary and bid-term exports remain available.

## Evidence

- `npx tsc -b`: passed.
- `npm test`: 298 passed, 0 failed.
- `YARNFLOW_TEST_PORT=8797 npx playwright test e2e/purchase.spec.ts e2e/roles.spec.ts e2e/purchase-mobile.spec.ts --project=desktop-chromium`: 15 passed; the mobile-only test is skipped on desktop.
- `YARNFLOW_TEST_PORT=8797 npx playwright test e2e/purchase-mobile.spec.ts --project=iphone-webkit`: passed. It checks Urdu supplier/order headings and no horizontal overflow at phone width.

## Integration required from Task 18

Register `PurchaseScreens` as `MODULES.purchase_manager` in `ModuleViews` and pass the actual signed-in admin `member`, `section`, `tab`, `id`, `navigate`, and inventory refresh callback. Do not synthesize a PM member for admin module routes; `InterventionField` relies on the actual role. The current `LiveApp` purchase fallback should be retired after that registration is integrated and verified.

## Dependency

Task 16 owns `/erp/analytics/purchase`. Until that endpoint is available, the analytics view displays its returned error and explains that analytics are unavailable; no metrics are fabricated. Re-run the analytics section after Task 16 lands.
