# 05 — Edge Cases (each needs a test; ID goes in the test name)

Format: **ID · Situation → Required behaviour**

## A. Data entry & validation
- **A01** Quantity entered with text/units ("285.4 kgs", "12 ctn") pasted or typed → strip units,
  parse the number, show the cleaned value; reject if ambiguous.
- **A02** Comma in a weight ("285,415") is ambiguous (decimal comma vs thousands separator) →
  ask "Did you mean 285.415 kg or 285,415 kg?" and use the expected range to pre-select the
  likely answer. Never silently guess for weights.
- **A03** Zero or negative quantity → block with message (except Stock Adjustment, which allows −).
- **A04** Weight per cone outside spec tolerance → soft warning with expected range; allow with
  optional note; flag in dashboard "abnormal weights".
- **A05** Cones ≠ cartons × usual cones/carton → no block; show computed value; warn only if
  > tolerance.
- **A06** Mixed lots: sum of lot-line cones ≠ total cones → block with live difference shown.
- **A07** Same lot added twice in lot lines → merge or block with message.
- **A08** Duplicate supplier invoice no. for same supplier → warn "Already received on 12/08
  (GRN-26-000031). Is this a different delivery?" Allow with reason.
- **A09** Duplicate lot no. for same supplier+spec on a new receipt → offer "Add to existing lot".
- **A10** Possible double-tap/double entry (same type, machine, lot, quantities within 2 min) →
  warn "Looks like the same entry was just saved".
- **A11** Very large values (> 3× the 90-day max for that field) → soft warning.
- **A12** Leading zeros / spaces / case in codes ("1a", " 1A ") → normalise to master value.
- **A13** Required master data missing (no machines configured) → empty state guiding Manager to set
  up; operators see "Ask the manager to add machines".
- **A14** Very long names (customer, notes) → truncate with ellipsis in lists, full in detail; limit
  notes to 500 chars with counter.
- **A15** Emoji / Urdu / mixed scripts in names → stored and searched correctly (NFC normalisation).

## B. Stock integrity
- **B01** Issue/dispatch more than available → hard block; show available and where it is.
- **B02** Two devices offline both use the last 10 cartons → first to sync posts; second goes to
  "Needs attention" with explanation and options; never negative stock on server.
- **B03** Dispatch from a lot on QC Hold → hard block with reason and who placed the hold.
- **B04** Entry against a Closed lot → block; Manager can reopen lot with reason.
- **B05** Void a receipt whose stock was already issued → block; show dependent entries; offer to
  void dependents first or use Stock Adjustment.
- **B06** Void a dispatch → stock returns; linked order pending kg recalculates; delivery note marked
  VOID on reprint.
- **B07** Customer return → choose: back to stock (same lot) or waste/rework; linked to original DN.
- **B08** Physical count differs from system → variance report; posting creates adjustments with
  reason; owner notified above threshold.
- **B09** Rounding: kg split pro-rata across mixed lots → use integer grams, allocate remainder
  to largest line so total matches exactly.
- **B10** Lot partially in carton with loose cones → support loose cones (cartons may be fractional
  only via cones; carton count is integer, cones carry the remainder).

## C. Time, dates & shifts
- **C01** Night shift crossing midnight (e.g. C: 23:00–07:00) → business_date = shift start date
  (configurable); entries at 02:00 belong to previous business date.
- **C02** Backdated entry within allowed window (default 2 days) → allowed with banner
  "You are entering for 22/10"; beyond window → Supervisor+ with reason.
- **C03** Entry into a closed day → blocked; Manager can reopen.
- **C04** Entry into a locked month → blocked for everyone; Owner can unlock with reason (audited).
- **C05** Future date → blocked.
- **C06** Phone clock wrong → server time is authoritative when online; offline entries store
  device_time; on sync, if device clock differs > 10 min from server, flag the entry and show
  "Phone time was wrong; please confirm date" for future-looking or > 1 day shifts.
- **C07** Shift times changed in settings → applies from the next business date; history unchanged.
- **C08** Holiday with production → allowed; dashboard averages exclude holidays unless entries exist.

## D. Offline & sync
- **D01** Save while offline → stored locally (encrypted at rest where supported), status
  "Waiting", appears in lists and stock (marked as pending).
- **D02** Network drops mid-request → retry with same client_id (idempotent); never duplicate.
- **D03** Power loss / app killed during save → on restart, outbox intact; draft intact.
- **D04** Server rejects synced entry (validation, locked day, permission changed) → "Needs
  attention" with plain reason and actions; supervisor notified.
- **D05** Master data changed by Manager while device offline (e.g. lot closed, spec archived) →
  device pulls changes on reconnect; pending entries re-validated server-side; conflicts to
  Needs attention.
- **D06** Two managers edit the same master record → last-write-wins only for non-critical fields;
  show "Updated by X a moment ago — review changes" with diff before overwrite.
- **D07** Entries waiting > 24 h → warning banner and notification to supervisor.
- **D08** Browser storage cleared / app uninstalled with pending entries → warn persistently
  while pending exist ("Don't clear app data — 3 entries not yet sent"); request persistent
  storage (`navigator.storage.persist()`); offer "Export pending entries" file as backup.
- **D09** Low device storage → warn; photos compressed (max ~300 KB) and uploaded first when online.
- **D10** App update available while entries pending → update only after outbox is empty or
  migrate outbox schema safely; never discard.
- **D11** Same user logged in on two devices → allowed; entries attributed by device.
- **D12** Slow network (2G) → app shell cached; requests time out gracefully with retry; no
  frozen UI.

## E. Users, security & devices
- **E01** Forgotten PIN → Supervisor/Owner resets; user sets new PIN at next login.
- **E02** Brute-force PIN → lockout (S0) + owner alert.
- **E03** Lost/stolen phone → Owner revokes device; session tokens invalidated; local data
  unreadable without valid login.
- **E04** Employee leaves → deactivate; history keeps their name; cannot log in.
- **E05** Role downgraded while logged in → next request enforces new permissions; UI refreshes
  with message.
- **E06** Session expires mid-form → re-auth sheet over form; draft preserved; continue.
- **E07** Operator tries a URL for a forbidden screen → permission-denied state with "Go home".
- **E08** Shared phone, user switch → quick switch from header; drafts are per user and private.

## F. Printing, sharing, files
- **F01** WhatsApp not installed / desktop → fall back to Web Share, then "Copy link" and
  "Download PDF".
- **F02** Urdu text in PDFs → embedded Nastaliq font, correct shaping and RTL; numbers LTR.
- **F03** Delivery note reprint → marked "COPY"; voided DN marked "VOID".
- **F04** Large exports (100k rows) → generated server-side in background with notification.
- **F05** Camera permission denied (scan/photo) → explain how to allow; manual entry always available.
- **F06** Damaged/unreadable QR → manual carton ID entry; reprint label option.
- **F07** Scanning a carton already dispatched / from another customer's DN → block with its
  current status and link.

## G. Import & OCR
- **G01** Excel with merged cells, headers in wrong row, Urdu headers, dates as text or Excel
  serials → mapping step handles; preview shows parsed values for confirmation.
- **G02** Partial import errors → import valid rows only on request; downloadable error file.
- **G03** Re-importing same file → duplicate detection by content hash + row keys; warn.
- **G04** OCR low confidence cells → highlighted, must be confirmed; nothing auto-saved.

## H. Reporting & dashboard
- **H01** No data for filters → explicit empty state with "Clear filters".
- **H02** Partial day (shift in progress) → labelled "so far"; comparisons use same time-of-day.
- **H03** Yield for open lots → labelled "estimate"; final only when lot is closed.
- **H04** Division by zero (no issues yet) → show "—" with reason, never NaN/Infinity.
- **H05** Very large numbers in tiles → compact format with exact value in tooltip.
- **H06** Timezone: all reports in Asia/Karachi business dates regardless of viewer device timezone.

## I. Localisation & display
- **I01** Urdu mode with numbers, serials, lot nos., phone numbers → LTR isolated; no reversed digits.
- **I02** Mixed-direction strings ("Lot 1221 – سپلائر") render correctly in lists, PDFs, WhatsApp text.
- **I03** Missing translation key → fall back to English, log once; CI fails on missing keys.
- **I04** System font scaling 200% → layouts reflow; no clipped buttons.
- **I05** Dark mode / Factory mode → all status colours still pass contrast.

## J. Data lifecycle
- **J01** Master renamed → historical records show the name at time of entry (snapshot) with
  current name available on hover/detail.
- **J02** Spec archived → hidden from pickers; still visible in history, stock and search
  (with "Archived" chip).
- **J03** Month lock → reports for locked months are immutable and reproducible.
- **J04** Backup restore test → documented and run monthly in staging.
