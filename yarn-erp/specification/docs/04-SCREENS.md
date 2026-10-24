# 04 — Screens

Each screen lists: **Purpose · Who · Layout · Behaviour · States**. "All states" means:
loading, empty, error, offline, permission-denied, success (see AGENTS.md rule 8).

## S0. Language & Login
- **Purpose:** get in fast on shared phones.
- **Layout:** language toggle (English | اردو) at top; factory name/logo; user picker (avatars +
  names of users who logged in on this device, max 8, then search); 4–6 digit PIN pad (large keys,
  56 px+); "Forgot PIN? Ask your supervisor" text. Owner/Manager: phone/email + PIN + OTP.
- **Behaviour:** 5 wrong PINs → 5-minute lock with countdown, owner notified. Device registered on
  first login by Manager/Owner approval. Login works offline for users who logged in on this device
  in the last 14 days (cached hashed credential), with server re-check on reconnect.
- **States:** offline login allowed/not allowed message; locked; device not approved ("Ask the owner
  to approve this phone" + device code).

## S1. Home (role-based)
- **Operator:** greeting + business date + shift ("Shift A · Sat 24/10"), 1–4 Big Action Tiles for
  assigned tasks, "Today's Entries" list (own), drafts badge, sync indicator.
- **Supervisor:** 6–8 tiles in daily-frequency order (Record Production, Issue to Machine,
  Record Cops, Issue to TFO, Receive Yarn, Dispatch, Search, Day Close), shift summary card
  (production so far vs target), attention items for their area, Today's Entries (all users of shift).
- **Manager/Owner:** Attention panel + Today KPIs at top, then tiles, link to full Dashboard.
- **States:** first-run (guided tour prompt + Practice Mode suggestion), offline, unsynced items,
  day not closed yesterday (banner with "Close now").

## S2. Quick Entry flow (template for all transactions)
- **Purpose:** guided, one-question-per-step entry for novices.
- **Layout:** app bar with step indicator ("2 of 5"), question as title ("Which machine?"),
  one input/picker, helper/context card (e.g. selected lot's stock), sticky bottom: Back | Next
  (Next becomes "Review" on last step).
- **Steps example — Record Production:** 1 Machine (tiles of machines, last used highlighted)
  → 2 Spec & Lot (pre-filled from what the machine was last fed; "Mixed lots?" link opens Lot Line
  Editor) → 3 Cartons & Cones (stepper; cones auto = cartons × usual, editable) → 4 Net weight
  (shows expected range and kg/cone live) → 5 Review (Confirmation Summary) → Saved screen
  (big ✓, serial no., "Add another" primary, "Done", Undo toast).
- **Behaviour:** draft autosave; back never loses data; skip steps that have only one possible
  value; date/shift shown in header with "Change" link (backdate rules apply).
- **States:** validation per step; soft warning step-in ("This weight is lower than usual for
  this spec (0.90 kg/cone vs usual 0.99). Continue? Add a note (optional)").

## S3. Register View (expert/bulk entry and review)
- **Purpose:** mirror the paper registers A, B, C for fast entry and familiarity.
- **Layout:** tabs: Lot Sheet | Production | Daily Summary. Grid with paper column order; date &
  shift filter; "Add row" at bottom (inline editable); totals row; per-row status chip.
- **Behaviour:** Enter → next row, Tab → next cell; pickers inside cells with type-ahead; paste
  from Excel (validates each row, shows errors per cell); rows save individually (each is a
  transaction) with the same validation as Quick Entry; posted rows are read-only (edit = void flow).
- **Phone:** suggests landscape; otherwise shows rows as cards with "Add row" sheet.
- **States:** row-level errors highlighted with message on focus; unsaved rows marked; offline.

## S4. Transaction forms (single-page variants)
Same fields as Quick Entry on one scrollable page for confident users. Sections: Context
(date, shift, machine) → Material (spec, lot lines) → Quantities → Notes/Photos → sticky Save.
Mode toggle remembered per user per transaction type.

Specific notes:
- **Receive Yarn:** supplier picker → invoice no. (duplicate check per supplier) → spec (or create,
  if permitted) → lot (existing or new; new lot no. uniqueness per supplier+spec) → cartons/cones →
  gross/tare/net → invoice photo (camera). Shows "Expected from invoice" fields optional.
- **Issue to Machine:** machine → lot (only lots with stock; shows stock) → cartons (stepper,
  max = stock) → cones (auto) → kg (auto estimate, editable).
- **Cops / Issue to TFO:** machine/TFO → lot (shows cops balance) → count.
- **Dispatch:** customer → open orders for customer (pick or "No order") → lines via scan or
  picker (spec → lot with FIFO suggestion, oldest first) → cartons/kg (cannot exceed stock) →
  gate pass, vehicle, driver → Review → Save → Delivery Note PDF preview → Share (WhatsApp)/Print.
- **New Order:** customer → fabric → GSM → Yarn Selection Guide suggestions with stock → lines → date
  → rate (optional) → Save.

## S5. Today's Entries / Entry List
- Filter chips (type, machine, shift, user, status), search, grouped by shift. Row shows serial,
  type icon, summary sentence, who/when, status chip. Tap → Entry Detail.

## S6. Entry Detail
- Full record, plain-language summary, created by/when/device, sync status, photos, linked records
  (lot, order, delivery note), audit history. Actions: Undo (≤ 5 min, own), Void (with reason),
  Duplicate as new, Share/Print.

## S7. Global Search
- One field, searches: serial, lot no., carton QR, DC/gate pass, invoice no., customer, supplier,
  spec label, machine, vehicle no., date ("14/8" or "yesterday"). Scan button in field.
- Results grouped by type with counts; recent searches; typo tolerance; Urdu and English names.
- **States:** no results → suggestions ("Check the lot number or try the supplier name") +
  "Search in archived/voided" toggle.

## S8. Lot / Spec / Customer / Machine detail pages
- Header with key numbers (stock kg, cartons, cops balance, age); **Timeline** of all events;
  tabs: Movements (ledger with running balance — the digital Lot Sheet), Quality, Orders/Deliveries.
- Actions per permission: QC Hold/Release, Close lot, Print lot ledger.

## S9. Stock
- Default: Finished stock by spec (cards on phone, table on desktop) with kg, cartons, aging,
  days-of-cover chip. Switch: Raw stock / Cops WIP / Finished. Matrix view (Count × Content).
- Tap → lots → carton list (if QR used) → timeline.

## S10. Dashboard (Manager/Owner) — see 01 §8
- Layout desktop: Attention panel (left/top, max 7 items, each with action) → KPI row (4–8 tiles)
  → charts grid (2 columns) → tables. Phone: single column in the same order; charts collapsed to
  "headline + sparkline", tap to expand.
- Global filter bar sticky; date presets (Today, Yesterday, This week, This month, Last 30 days,
  Custom). Every KPI and chart point drills down to entries.
- Each chart has: title as a question it answers ("Which machine produced least this week?"),
  "View as table", export.
- **States:** partial data (some charts still loading), no data for filters, stale data offline
  ("Showing data as of 14:05").

## S11. Reports
- List of reports (01 §9) with description; parameters (date range, spec, lot, customer);
  preview on screen; Export PDF/Excel; Share via WhatsApp; Print. Urdu/English selectable per report.
- Paper-Match report printed on A4 in the old register layout.

## S12. Day Close
- Supervisor: summary of the shift/day (production, issues, dispatch, closing stock, entries by
  user), checks list (unsynced entries, warnings acknowledged, missing shifts), remarks field,
  "Approve & Close". After close: day read-only; WhatsApp summary prepared for Owner.
- Manager/Owner can Reopen with reason (audited, owner notified).

## S13. Sync Center
- Lists: Waiting to sync (with time), Synced today, **Needs attention** (server rejected — e.g.
  stock already used by another device) with plain explanation and actions: Edit & resend,
  Void, Ask supervisor. Device storage status; "Sync now" button; last successful sync time.
- Warning if the app storage is about to be cleared/low or if entries are waiting > 24 h.

## S14. Masters (Manager/Owner)
- One list screen per master with search, add, edit, archive/restore. Edits to names never change
  history (snapshots). Specs editor builds the label live. Packing defaults & tolerance per spec.
  Yarn Selection Guide editor (table with fabric, GSM from–to, recommended specs).

## S15. Users & Devices (Owner)
- Users: name, role, permissions overrides, assigned tasks/machines, language, PIN reset,
  deactivate (never delete). Devices: approve, rename, revoke (forces logout, keeps unsynced
  data encrypted until a valid user syncs it).

## S16. Settings (Owner)
- Factory profile (name, logo, address, NTN/STRN), shifts, holiday calendar, backdating window,
  tolerances, targets, number format, month lock, notification recipients, backup/export,
  Practice Mode reset.

## S17. Import Wizard
- Choose type → download template → upload → column mapping (auto-matched) → preview with errors
  per row in plain words → "Import valid rows" / "Fix and re-upload" → result summary + undo import
  (within 24 h, if no dependent entries).

## S18. Practice Mode
- Toggle from Home/Help. Separate local dataset seeded with realistic dummy data (specs, lots,
  machines, last 30 days of entries). Purple stripe + banner on every screen. Exiting returns
  to real data. Practice entries never sync to the server.

## S19. Help
- Guided tour replay, tips, short videos, glossary (EN/UR), "Call/WhatsApp support" contact,
  app version, "Report a problem" (attaches non-sensitive logs).
