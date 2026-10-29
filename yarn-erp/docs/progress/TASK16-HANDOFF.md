# Task16 analytics handoff

Implementation commit: `1907350ac7fd410d4a27695efb9ef57eef543008`.

## Implemented

- Added admin, sales-manager and purchase-manager analytics endpoints with server-side role checks and validated inclusive `from`/`to` ranges. Admin dispatch counts cover each Task14 status.
- Sales totals use invoice balances net of credit notes; payments/status and overdue balances use exact integer minor units and stay grouped by invoice currency. Periods use the plan's UTC+5 Karachi calendar-month expression.
- Admin quality uses final settled lot dispositions, not repeated inspections; purchasing reuses `supplierPerformance`; current inventory reads retain raw, cops, WIP and finished stages.
- Purchase bid counts follow RFQs created in the selected period. The paid status includes invoice payments and credit notes.
- Mounted `/api/erp/analytics/*` through the existing inventory router.

## Evidence

- `node --test tests/analytics.test.mjs`: 8 passed, 0 failed.
- `npm test`: 306 passed, 0 failed.
- `npx tsc -b`: passed with no output.
- The migration fixtures applied a byte-for-byte temporary copy of Task14's `0018_dispatch.sql` from its owning worktree; `cmp` confirmed it matched. That copied migration is not part of this commit.

## Dependency

Task14's `drizzle/0018_dispatch.sql` is still owned in its separate worktree and must be cherry-picked into this checkout for a clean checkout to run the analytics suite. Its exact schema defines `dispatches.status` as `pending_approval | approved | on_hold | dispatched | delivered`. The admin block and a nonzero status-count assertion are implemented; no migration was added to the implementation commit. The temporary exact migration copy remains untracked in this working tree until Task14's cherry-pick lands; remove it after that.

No production database or fixtures were changed. No migrations were added.
