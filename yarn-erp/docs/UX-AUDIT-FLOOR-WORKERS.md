# Yarnflow floor-worker UX audit (Phase 1)

Audited version: the live site, `origin/feat/factory-portal` @ `2492b3a` (built bundle is byte-identical to
https://yarnflow.yarnflow-workspace.workers.dev). Tested locally on test data at 360×740 (phone) and 800×1280 (tablet).

Evidence: code read of every live file (`main.tsx` → `LiveApp.tsx` / `SupplierPortal.tsx` and everything they import;
`App.tsx`, `domain.ts`, `LoginPage.tsx`, `Sales.tsx`, `BuyerPortal.tsx` are not reachable), a Playwright measurement
pass, an Antigravity customer walkthrough (96 screenshots, every task, deliberate mistakes, offline, six roles) and two
independent Codex code audits.

Unknowns that change some fixes (marked ❓): devices in use, the register's unit (bags / cartons / cones / kg), whether
a bag has a fixed weight, and whether deliveries arrive without a purchase order.

## 1. Map of the app

Bottom bar on phones: Home · Stock · Scan · History · More (More = Procurement, Team, Settings, Help, sign out).
Every role sees the same bar; Procurement is shown to admin, purchase manager and supervisor; Team to admin.

| Task | Path (phone) | Taps | Typed fields | Dropdowns |
|---|---|---|---|---|
| Sign in | name → 4-digit keypad | 5 | 0 | 0 (language is two buttons) |
| Check stock of one yarn | Stock → type in search → read kg | 2 + typing | 1 | 0 |
| Receive a delivery (no PO) | Stock → find material → batch → Receive stock → kg, cartons, cones → Review → Save | 7–9 | 3–4 | 2 (batch, "Receive into") |
| Receive a delivery (with PO) | More → Procurement → Incoming stock → Receive purchase order → material, batch no., qty, cartons, cones → Save | 6 | 4–5 | 1 (material) |
| New delivery that needs a new batch | Stock → New batch (material, batch no., supplier) → Review → Save → then Receive as above | 12+ | 6+ | 3 |
| Issue to production | Stock → batch → Move stage → from, to, kg, cartons, cones → Review → Save | 7–9 | 3–4 | 3 |
| Record waste | Stock → batch → Record waste → stage, kg, cartons, cones → Review → Save | 7–9 | 3–4 | 2 |
| Return from floor | not a task; Move stage with "from WIP to Raw" | 9+ | 3–4 | 3 |
| Correct a mistake | History → find row → Reverse entry → type reason → Review → Save (or "Undo entry" right after saving) | 4–5 | 1 | 0 |
| Inspect + QC approve | batch → Add inspection → note → Review → Save → Review quality → decision → reason → Review → Save | ~12 | 2–3 | 2 |
| Dispatch | batch → Dispatch → stage, kg, cartons, cones, note → Review → Save | 7–9 | 4 | 2 |
| Scan fabric / yarn count / label | Scan → tab → camera | 2–3 | 0 | 0 |
| Purchasing (RFQ, bids, PO) | More → Procurement → … | many | many | several + 2 date-time pickers |

## 2. Findings, by severity

### Critical — wrong stock or a blocked task

**C1. Purchase-order receipt books the wrong material and an assumed quantity, without review.**
`IncomingStock.tsx:25-30`. Material starts as the first material in the list, the quantity starts as the whole
outstanding order, cartons and cones start at 0, and there is no review step. The server only checks that the material
exists (`server/receiving.mjs:19`). One tap on Save books the full order under whatever yarn sorts first.
*Fix:* nothing pre-selected; quantity starts empty with "Order still to come: 2,000 kg" beside it; material shown as
big cards (PO title first); add the same review sentence as other entries. *Severity: Critical.*

**C2. Units: only kilograms are required; bags/cartons and cones silently default to 0.** `LiveApp.tsx:42,83`. Floor
staff count bags/cartons and cones; kg is what the scale says. A worker typing "40" for 40 bags records 40 kg, and
counts stay 0 while kg is right — the register no longer matches. ❓ Register unit.
*Fix (no schema change):* show the count field first in the factory's own word (copy file), required with no pre-filled 0 (0 allowed for loose stock);
kg second with a label "Weight on the scale (kg)"; warn when kg-per-bag is far from that batch's previous receipts
("40 bags but only 40 kg — is that right?"). *Severity: Critical.*

**C3. Wrong values pass the details step and fail only after Save, with the boxes hidden.** `forms.tsx:224`,
`LiveApp.tsx:63`. 0, negative, letters or more than is available all reach "Review", then Save shows
"Enter a positive weight of up to 9,000,000,000 kg." / "Enter kilograms with up to three decimal places." / "Stock
changed, the quantities exceed available stock, or this entry was already reversed…" under a summary with no inputs.
*Fix:* check on the details step, inline under the box, in plain words with the number: "Only 6,750 kg is in Store.
You typed 50,000 kg." Keep server checks. *Severity: Critical (blocks; invites guessing).*

**C4. The footer says "All changes saved" while offline and after failures.** `LiveApp.tsx:329` (static text). Offline
Home also shows "Could not confirm a save…" when nothing was being saved (`inventory-client.ts:56` message reused for
reads). The worker cannot tell whether an entry went through. *Fix:* footer reflects the real state: Offline · Saving… ·
Saved 10:42 · Not saved — tap to retry; read failures say "Can't reach the server. Your entries are not lost." *Critical.*

**C5. Retrying after an uncertain timeout can double-book.** `LiveApp.tsx:47` gives the entry a new id on every
keystroke, so "fix one digit and retry" after a timed-out save that actually succeeded posts a second movement. The
message says "duplicate requests are safe". *Fix:* keep the id until the server answers; after an uncertain result,
first check History for that id and say "This entry was saved" or "Not saved — try again". *Critical (rare, silent).*

**C6. Old unfinished entries come back pre-filled.** `LiveApp.tsx:41-49`. Cancelling keeps the draft in the phone; days
later the same form opens with yesterday's kg already typed. *Fix:* clear on Cancel; drafts older than 12 h are dropped;
otherwise show "You left this unfinished at 10:15 — Continue / Start new". *High → Critical if a stale value is saved.*

### High — confuses most users or slows them down

**H1. Home is a QC dashboard, not a daily-work screen.** `WorkspaceDashboard.tsx:58-71`. The first card is "Review the
QC hold on …"; there is no Receive / Issue / Waste / Correct button anywhere on Home. Every stock entry starts with
finding the batch in Stock. *Fix:* a grid of big icon+word buttons for the tasks the person is allowed to do, then a
batch picker with recent batches first. Every daily task in one tap from Home.

**H2. Dropdowns on every entry form.** Batch, "Receive into", "From stage", "To stage", QC decision, material
(`LiveApp.tsx:78-85`, `IncomingStock.tsx:28`). Native pickers are unfamiliar and hide the screen. *Fix:* each action
fixes its stages (Receive → Store; Issue to production → Store→Floor; Return from floor → Floor→Store; Waste → from Floor
by default), batch comes from where you started, choices that remain are big cards.

**H3. Words workers don't use.** "Work in progress", "Cops", "Move stage", "QC hold", "uninspected", "SKU", "Batch / dye
lot", "Reverse entry", "Review entry", "audit history", "client supplied", "Asia/Karachi" (History header), "operator".
*Fix:* one copy file with plain trade words (Store / Floor / Ready / Issue to production / Return / Wastage / Correct a
mistake …), reviewed by someone who talks to the floor. ❓ exact floor words.

**H4. Confirmation is a list of labels, not a sentence.** `LiveApp.tsx:69-73`, `forms.tsx:232`. "Weight 40 kg ·
Cartons 0 · Cones 0" — a 0 doesn't stand out. *Fix:* one plain sentence + big numbers ("40 bags · 1,814 kg of Combed
cotton 30/1, batch LOT-1024, into Store"), zero counts flagged in amber, then a full-screen "Saved ✓" with Undo.

**H5. Urdu breaks exactly when something goes wrong.** Server errors, client validation (`inventory-client.ts:309-312`),
stock empty states (`LiveApp.tsx:281-283`), History "Today/Yesterday" and procurement/order statuses are English. Urdu numbers sometimes flip around "kg". *Fix:* every user-facing string in one copy
module with an Urdu pair; server returns error codes the client words itself; numbers wrapped LTR.

**H6. No storekeeper role; receiving lives in two places.** `server/auth.mjs:6-12`. Roles: admin, purchase manager,
quality inspector, supervisor, sales manager, dispatch. A storekeeper must be "supervisor" (also gets procurement) or
"purchase manager". Two receive paths (Stock → Receive; Procurement → Incoming stock) with no guidance which to use.
*Fix (needs approval — touches permissions):* add a Storekeeper role = receive, issue, return, waste, materials &
batches; show one "Receive delivery" button that offers "Against an order" only when open orders exist. ❓ No-PO deliveries.

**H7. Every role gets the same screens.** Sales manager has sales/payments permissions but no Sales page in the live
menu; quality inspector lands on stock totals instead of "batches waiting for you". *Fix:* the Home task grid (H1) is
filtered by permission; procurement stays out of floor roles' way.

**H8. Two forms to pass one batch through QC.** Inspection then QC decision, each with review (≈12 taps). *Fix:* keep
both records (they need separate permissions and both require a note, `server/inventory.mjs:233-244`), but make each a
short screen: QC decision as two big buttons Pass / Hold with quick-reason buttons that fill the note. Merging them
into one save is not safe without a server change, so it is out of scope.

**C7 (flag, needs owner decision). QC can be approved with no inspection on record.** `server/inventory.mjs:233` does
not check that an inspection exists. The UI steers people to inspect first, but the rule is not enforced. This is a
business rule, so I will not change it without your say-so.

### Medium

**M1. Text below 16 px on every screen** (10–50 items per screen): field labels 15 px, form step labels 12–13 px, stage
names, supplier names, timestamps, nav labels 14 px. *Fix:* body ≥ 17 px, labels 17 px bold, key numbers 28–40 px.

**M2. Touch targets below 48 px:** Find-a-batch, Close form, menu Close, Sign out, "+ New batch" (44×44), language
EN/اردو (46×44), "Reverse entry" and History batch links (h 44), Not Anas? (h 44). Primary actions are 48 px; should be
≥ 56 px for gloved/dusty hands. Checkboxes 20 px in Team/Procurement.

**M3. Corrections are hard to find.** Reverse is a small text link beside a timestamp; the reason is free text.
*Fix:* "Correct a mistake" on Home and on each recent entry; quick reasons as buttons ("Wrong weight", "Wrong batch",
"Entered twice") plus optional note.

**M4. Returns are not a task.** Floor→store returns need Move stage with two dropdowns. *Fix:* "Return from floor"
preset (stage transfer only, no new data).

**M5. Language switch only on sign-in and in Settings.** *Fix:* EN | اردو pill in the top bar.

**M6. Tablets in portrait (800 px) get the phone layout** (`yarnflow.css:871,892` breakpoint 900 px). *Fix:* sidebar
from 768 px.

**M7. Receive form layout:** the close (X) floats under the description, the weight box shows placeholder "0.000",
"Available" shown on Receive (irrelevant). Recent entries for the batch are not visible on the entry form (register
habit). *Fix:* X in the corner, no fake zeros, last 3 entries of this batch under the form.

**M8. Success notice is small text at the top of the next page;** after saving, the worker lands on batch details and
may not see it. *Fix:* full-screen "Saved ✓" card with the sentence, Undo, and "Record another".

### Low

**L1.** Dates are en-GB ("29 Oct, 12:00"), numbers use western grouping; fine for most staff — confirm whether lakh
grouping (12,34,567) is expected. **L2.** Decorative animated thread on Home stock flow. **L3.** Supplier portal's
12-character password and datetime pickers are for suppliers and office staff, out of scope for floor workers — noted
only. **L4.** "Skip to content" link takes a 148×44 slot at the top when focused (fine).

## 3. The five changes that would make the biggest difference

1. **Make every entry correct before it can be saved:** count-first quantities in the factory's unit, inline plain
   checks against available stock, nothing pre-filled or pre-selected (C1, C2, C3, C6).
2. **Home = daily work:** big icon+word buttons for Receive, Issue to production, Return, Waste, Correct a mistake,
   each going straight to a big-button batch picker with fixed stages — no dropdowns (H1, H2, M3, M4).
3. **One plain sentence to confirm, a clear "Saved ✓", Undo** (H4, M8).
4. **Honest save status and safe retries:** real footer state, offline messages that say nothing is lost, same id on
   retry (C4, C5).
5. **Floor language in one translatable copy file**, Urdu everywhere including errors, ≥ 17 px text, ≥ 48/56 px targets
   (H3, H5, M1, M2).

Needs a decision before Phase 2: H6 (a Storekeeper role needs a migration of the seeded `roles` table, `admin.mjs`,
Team picker and RBAC tests — not a one-line change), C7 (enforce inspection before QC approval) and C2 option B (kg per
bag needs a schema change; deferred until the factory confirms bags have a fixed weight). Everything else is presentation and client-side checks; stock calculations and the data model stay as
they are.

Reviewed by Codex against the code: agreed on C3, C6, H1, H3, H7; adjusted C1, C2, C4, C5, H2, H4, H5, H6; H8
rewritten after it showed the two QC records cannot be merged safely client-side; C7 was found by Codex.
