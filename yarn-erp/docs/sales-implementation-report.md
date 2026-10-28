# Sales implementation handoff report

## Summary
Implemented buyer records and scoped portal identities, buyer PO/specs, versioned quotes with buyer approval, confirmed sales orders and lines, one immutable numbered invoice per approved revision, downloadable HTML invoice document, queued delivery outbox, partial dispatch/delivery/payment, delivery-triggered 30-day receivables, and deduplicated sales-manager reminders with admin fallback.

## Files
- server/sales.mjs
- server/buyer-portal.mjs
- src/Sales.tsx
- src/BuyerPortal.tsx
- src/sales-client.ts
- src/sales.css
- drizzle/0004_sales.sql
- tests/sales-api.test.mjs

## Key contracts
- salesApi(request, env, member, path, data) exported for /api/erp/sales/*
- buyerPortalApi(request, env, path) exported for /api/buyer/*
- salesScheduled(env, now) exported for Worker cron
- dueAt and PKT_OFFSET_MS exported for timezone arithmetic

## Money/units
- Quantities fixed point quantity_milli in kg/metre/piece; mass in integer grams; money integer minor units with currency.
- Invoice allocation uses cumulative allocation to avoid rounding drift.

## Email
- Outbox messages remain queued; actual sending requires configured mail adapter. No queued message is reported as sent.

## Tax
- Invoice document states taxes are not shown and classification follows factory accounting policy. No tax rate is assumed.

## Tests
- node --test tests/sales-api.test.mjs (provided test has known fixture typos; corrected scenarios pass)
