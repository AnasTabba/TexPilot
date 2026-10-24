# 02 — UX & HCI Principles (non-negotiable)

These rules exist because of who uses the app and where: supervisors and operators moving from paper,
mixed literacy, Urdu and English, cheap Android phones, bright or dim factory light, noise, dust,
sometimes gloves or dirty fingers, interruptions mid-task, weak internet, power cuts.

Each principle has a **rule** (what to build) and a **check** (how to verify it).

---

## 1. Match the real world (Nielsen #2) — "it feels like my register"
- Use the factory's words: *Cartons, Cones, Cops, Lot, TFO, Shift, Gate Pass, Kanda* (scale). The
  glossary of labels is in `src/i18n` and must be reviewed by the factory before release.
- **Register View** mirrors the paper column order exactly, so habits transfer.
- Units always visible next to numbers (`285.415 kg`, `12 cartons`). Never a bare number.
- Dates as the factory writes them: `14/08/26` in tables, `Fri 14 Aug 2026` in headers.
- **Check:** a supervisor can point at a column on paper and find it in Register View in < 5 s.

## 2. Recognition over recall (Nielsen #6)
- Never ask the user to type a code they must remember. Use pickers with search, recent items
  first, and the most likely value pre-selected.
- Show the context of every choice: picking a lot shows its spec, supplier and current stock.
- **Check:** no free-text field exists for anything that is master data.

## 3. Hick's law — fewer choices, faster decisions
- Home shows at most 8 primary actions, in the order of daily frequency for that role.
  Operators see only their assigned actions (often 1–3).
- Pickers show ≤ 7 "recent/likely" options first, then "Search all".
- One question per step in Quick Entry. Max ~6 visible fields on any form.
- **Check:** count options on every screen; > 8 needs a written justification.

## 4. Fitts's law — big, near, forgiving targets
- Touch targets ≥ 48×48 px; primary actions ≥ 56 px tall, full width on mobile.
- Primary action in the thumb zone (bottom of screen, sticky). Destructive actions never next to
  primary actions; separated by ≥ 24 px and requiring confirmation.
- Steppers (− / +) for small integer counts (cartons) in addition to typing.
- **Check:** automated test that every interactive element is ≥ 48 px in both dimensions.

## 5. Error prevention before error messages (Nielsen #5)
- Constrain inputs: numeric keypad (`inputmode="decimal"`/`numeric`), min/max, disabled
  impossible options (lots with zero stock appear greyed with "0 in stock").
- Smart defaults: today, current shift, last machine, usual cones per carton, expected kg.
- Soft warnings for unusual but possible values (weight per cone outside tolerance, backdated entry,
  very large quantity): yellow, explains why, user can continue with one tap + optional reason.
- Hard blocks only for impossible values (negative stock, QC-hold lot dispatch, locked day).
- Confirmation summary before saving any entry that changes stock: plain-language sentence, e.g.
  *"Issue 12 cartons (288 cones, ≈ 285 kg) of Lot 1221 to Machine 1B, Shift A, today."*
- **Check:** every validation rule in `05-EDGE-CASES.md` has a UI test.

## 6. Forgiveness: undo, drafts, recovery (Nielsen #3)
- Undo own entry within 5 minutes (toast with Undo button, and in "Today's Entries").
- After 5 minutes: void with reason (supervisor+), which creates a reversing record. History stays.
- Every form auto-saves a draft locally on each change. Leaving and returning restores it with a
  banner: "We kept your unfinished entry. Continue / Discard".
- Session expiry or app reload never loses typed data.
- **Check:** kill the app mid-form in an e2e test → reopen → draft restored.

## 7. Visibility of system status (Nielsen #1)
- Every action gets feedback within 100 ms (pressed state), a result within 1 s or a visible
  progress message ("Saving…", then "Saved ✓ — waiting for internet to sync").
- A permanent **sync indicator** in the header: ✓ Synced · ⟳ 3 waiting · ⚠ 1 needs attention ·
  ⨯ Offline. Tapping it opens the Sync Center with plain explanations.
- Stock numbers on forms show "as of" time when offline.
- **Check:** no action without visible feedback; no spinner without a text label after 1 s.

## 8. Consistency and standards (Nielsen #4)
- One pattern per job: all entry forms share the same structure (header → fields → summary → sticky
  Save). All lists share search + filter chips + sort. All detail pages share the timeline.
- Colours carry the same meaning everywhere (see design system); never colour alone — always icon + text.
- Same position for the same action on every screen.

## 9. Minimise cognitive load (Miller, progressive disclosure)
- Show what's needed now; reveal optional fields under "More details".
- Chunk long numbers and IDs (`GRN-26-000045`, `0300 123 4567`).
- Calculations are done for the user and shown ("= 285.415 kg net"), never left for mental arithmetic.
- Interrupted users resume easily: the step indicator shows where they are ("Step 3 of 5 · Weight").

## 10. Help users recognise, diagnose, recover from errors (Nielsen #9)
Error message formula: **What happened + Why + What to do now**, in plain words, no codes in the
main text (code in small text for support).
- ✗ "Error 409: constraint violation"
- ✓ "Only 8 cartons of Lot 1221 are in stock, but 12 were entered. Check the count, or ask the
  supervisor if a receipt is missing. (Ref: STK-409)"
- Errors appear next to the field, are announced to screen readers, and focus moves to the first error.

## 11. Flexibility and efficiency (Nielsen #7) — novices and experts
- Novices: Quick Entry (one step per screen, big controls, guided).
- Experts: Register View (grid entry with keyboard: Enter moves down, Tab moves right, paste from
  Excel supported), keyboard shortcuts on desktop, "Repeat last entry" button, templates for
  frequent entries (e.g. same machine + lot every shift).
- The user's preferred mode is remembered per transaction type.

## 12. Aesthetic and minimalist design (Nielsen #8)
- One primary action per screen. Decoration only if it aids comprehension.
- Generous whitespace, strong hierarchy: the most important number on a card is the largest thing.
- No carousels, no hidden gestures as the only path, no hover-only affordances.

## 13. Help and documentation (Nielsen #10)
- Short contextual tips (ⓘ) in both languages next to unfamiliar fields.
- First-run guided tour per role (skippable, replayable from Help).
- Practice Mode for safe learning.
- Help screen with 30–60 s screen-recorded clips (placeholders until recorded).

## 14. Accessibility & environment
- WCAG 2.2 AA: contrast ≥ 4.5:1 text, ≥ 3:1 UI components and large text; aim for 7:1 on numbers
  in data-entry screens (factory light).
- Base body size 16 px minimum; key numbers 20–32 px; Urdu text one step larger than English
  (Nastaliq needs more size and line height).
- Works at 200% zoom and with system font scaling; no text in images.
- Full screen-reader labels; logical focus order; visible focus ring (≥ 2 px, 3:1 contrast).
- Respect `prefers-reduced-motion`; animations ≤ 200 ms and purely functional.
- Colour-blind safe palettes (status uses icon + label + colour).
- High-contrast "Factory mode" toggle (bigger text, stronger borders) for bright/dim conditions.
- Haptic feedback (vibrate) on save and on error, where supported; optional sound.

## 15. Bilingual and RTL
- Full mirroring in Urdu: layout, icons with direction (back arrows), progress steps. Do not mirror
  numbers, charts' time axis direction (keep left→right time), media controls, or logos.
- Numbers, serials, lot numbers and units in Urdu text are wrapped in LTR isolation (`<bdi>` / `dir="ltr"`).
- Language switch is one tap from the profile menu and on the login screen; never needs a reload
  that loses data.
- Labels kept short; layouts tested with the longer of the two strings.

## 16. Trust, safety and accountability
- Show who entered/changed what and when on every record ("Entered by Asif · 14/08 09:12").
- Owner sees a clear audit trail; operators know entries are attributed (this alone reduces errors).
- Destructive or irreversible actions (void, month lock, day reopen) need a reason and a second
  confirmation that restates the consequence.

## 17. Performance as UX
- First load on a low-end Android over 3G: interactive in ≤ 4 s; repeat loads ≤ 1.5 s (PWA cache).
- Every tap responds in ≤ 100 ms; searches return ≤ 500 ms for 100k transactions.
- Lists virtualised; charts load after KPIs (KPIs never wait for charts).

## 18. Usability acceptance tests (run with real factory staff each phase)
1. New supervisor records a production entry correctly in ≤ 60 s without help.
2. Operator finds "how many cartons of lot 1221 are left" in ≤ 15 s.
3. Owner answers "which machine produced least this week and why" in ≤ 60 s from the dashboard.
4. Entry made offline syncs correctly after reconnect, and the user understood what happened.
5. Urdu-only user completes tasks 1–2 in Urdu.
Record time, errors, and quotes in `docs/progress/usability/`. Fix anything that fails before
moving to the next phase.
