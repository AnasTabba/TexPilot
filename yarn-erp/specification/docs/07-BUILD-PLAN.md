# 07 — Build Plan

Work strictly phase by phase. Each phase ends with: all acceptance criteria green, screenshots in
`docs/progress/screens/`, a short demo note in `docs/progress/PHASE-N.md`, and the usability
tests from `02-UX-HCI-PRINCIPLES.md` §18 relevant to that phase.

## Definition of Done (every feature)
- Matches `04-SCREENS.md`; all states implemented (loading/empty/error/offline/denied/success).
- Works in English and Urdu (RTL), at 360 px and 1440 px, light/dark/Factory mode.
- Keyboard and screen-reader usable; touch targets ≥ 48 px; axe-core clean.
- Relevant edge cases from `05-EDGE-CASES.md` implemented and tested (test names include IDs).
- Server-side validation and permissions tested.
- No hard-coded strings, colours or sizes outside tokens/i18n.

## Phase 0 — Foundations (no business features yet)
- Monorepo, CI, lint/format, typecheck, test runners, Playwright with EN/UR × mobile/desktop projects.
- Design tokens (from `/design-templates` if present, else defaults in 03), fonts self-hosted
  (Inter, Noto Nastaliq Urdu), theme switch (light/dark/factory), RTL switch.
- `packages/ui`: Button, Input, Number/Weight input, Stepper, Picker (sheet/popover), Date/Shift
  selector, Toast, Banner, Dialog, Bottom sheet, Status chip, Sync indicator, Card, KPI tile,
  Empty state, Skeleton, Data table (virtualised), Filter bar, Timeline. A `/dev/components`
  gallery page showing every component in every state, both languages.
- Postgres schema v1, migrations, seed, Practice Mode seed.
- Auth: PIN login, device registration, roles, permission middleware.
- PWA shell, offline cache, IndexedDB (outbox, drafts), sync push/pull skeleton, Sync Center.
**Accept:** component gallery reviewed; login offline/online works; e2e for E01, E02, E06, D02, D03.

## Phase 1 — Replace the register (MVP)
- Masters: specs (spun + filament), lots, machines, shifts, suppliers, customers, packing defaults.
- Transactions: Yarn Receipt, Finished Production (incl. mixed lots), Dispatch + Delivery Note PDF,
  Stock Adjustment, Void/Undo.
- Stock screens; Lot detail with ledger (digital Lot Sheet); Entry list/detail; Global Search.
- Quick Entry + single-page forms + Register View (Production, Daily Summary).
- Day Close; Daily Summary report; Paper-Match report; WhatsApp share of daily summary & DN.
- Excel import (masters, opening stock); Practice Mode; guided tour; Help glossary.
**Accept:** usability tests 1, 2, 4, 5 pass with real staff; edge cases A*, B01–B06, B09, C01–C05,
D01–D08, F01–F03, G01–G03, I01–I04 tested; balances property test passes.

## Phase 2 — Control & insight
- Issue to Machine, Cops Produced, Issue to TFO, Waste; Register View Lot Sheet complete.
- Customer Orders, Yarn Selection Guide, order ↔ dispatch linking, Customer Return.
- Dashboard (01 §8) with drill-downs and filters; remaining reports; targets per machine.
- Physical stock count; month lock; Owner notifications.
**Accept:** usability test 3 passes; dashboard numbers reconcile with reports in automated tests;
edge cases B07, B08, B10, C06–C08, D09–D12, H*, J* tested.

## Phase 3 — Automation & quality (feature-flagged)
- QR carton labels (print + scan through receive → produce → dispatch), F05–F07.
- Digital scale integration (Web Serial / Bluetooth where supported; manual fallback).
- Register-photo OCR import with mandatory confirmation (G04).
- QC module with lot hold; Machine downtime; sales-tax invoice fields (NTN/STRN) on documents.
- Optional WhatsApp Business API for automatic messages.
**Accept:** each module behind a flag, off by default, with its own e2e suite.

## Rollout (non-code, tracked in `docs/progress/ROLLOUT.md`)
1. Set up masters + opening balances with the factory (import wizard).
2. Train supervisors in Practice Mode (30 min each).
3. Parallel run 2–4 weeks: paper + app; daily Paper-Match check signed by supervisor.
4. Fix top friction points weekly from usability notes.
5. Retire paper when 10 consecutive working days match.
