# Supplier procurement and receiving release — 28 October 2026

This is the first ERP implementation release on `feat/erp-workflows`.

Implemented:

- Six yarn supplier categories; supplier contact cards with country-code telephone links and email links.
- Separate supplier registration/password login, admin approval/rejection/suspension, scoped sessions, login throttling and auditable reviews. Admin manually verifies company/contact details during approval.
- Category-matched RFQs published to approved supplier portal inboxes, private versioned bids, rejection reasons, atomic single award, immutable accepted purchase terms and supplier purchase orders.
- Supplier dispatch notices with B/L, carrier, container numbers and bounded partial dispatch quantities.
- Purchase receipts create raw-material lots, QR labels and exact stock movements. Received stock starts uninspected; QC approval is required before raw stock can enter production.
- Receipt correction through immutable reversals that reconcile the purchase order and cannot reverse used stock.
- Permission presets for purchase, sales, production and inventory managers. Sales/payment/production-planning permission keys are foundations for the remaining modules, not a claim those workflows are released.

Still pending:

- Live DataLoopLabs requests, spending/credit controls and verified tracking updates. B/L notices explicitly show tracking as unconnected; no paid lookups are performed.
- Machine capacity, shifts, buyer-linked production batches, packing and production output tracking.
- Buyer order/quotation portal, invoices, receivables, payments and delivery-triggered reminders.
- Automated supplier email verification/recovery and email RFQ/invoice notifications. Portal inbox delivery works; emails are not sent. Existing supplier directory claims require manual admin review; automatic account-to-directory merging is not included.
- Supplier contact catalogue population: no invented or demo supplier contacts are seeded into production.

Verification:

- TypeScript and production build pass.
- 66 unit/API tests pass, including procurement authorization, approval, bid revisions, competing awards, shipment quantities, receipts, reversals and exact tonne-to-gram conversion.
- All 68 browser cases have passed across desktop Chromium and iPhone WebKit, including supplier registration through receipt/QR and Urdu layout. Existing tests were corrected for expanded permissions, persistent sessions and current sample quantities; accessibility tests inspect settled screens.
- Remote database export saved outside Git under the user's private local backup directory. Both migrations were rehearsed on that export; original table row counts were preserved and foreign-key checks passed.

Production migrations: `0002_procurement.sql`, `0003_purchase_receipts.sql`. They add the ERP tables and tighten the existing raw-stock issue QC gate. Existing inventory records are preserved. The scanner service is separate from this release and retains its trained model.

Published application commit: `f8c7fa4`. Cloudflare initial version: `bc05c2a8-ba73-4ad9-a505-a40c2d050151`; scanner URL secret update: `facdae3a-b015-41b7-9cf5-bc7e8bec3e94`.

Live smoke checks verified public supplier registration/category configuration, the password-verification path (unregistered login correctly returns 401), signed-in procurement/inbound reads and the rendered RFQ screen. A real scanner-v8 scan returned HTTP 200. No supplier account or business ledger test data was created on the live site.

Scanner resilience: `scripts/supervise-scanner-tunnel.zsh` is installed under the user's Library/Application Support/Yarnflow and run by launchd label `com.yarnflow.scanner.tunnel`. It checks the public model endpoint each minute and reconnects/updates the Worker URL after two failures. A pinned Wrangler runtime performs URL updates using its existing credential store. It requires this Mac/network and the model service to remain available. Logs and endpoint state stay outside Git in that runtime directory.
