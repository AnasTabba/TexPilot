# 03 — Design System

Templates in `/design-templates` replace the **values** below (colours, fonts, radius). The
**structure, sizes, states and rules** stay. All tokens live in one file
(`src/design/tokens.ts` → generated CSS variables) and are the only source of colour/size in the code.

## 1. Visual direction
"Calm, sturdy, legible." A tool people trust with their numbers, used for hours a day.
- Light theme by default (factory floors are bright); dark theme available; "Factory mode"
  high-contrast variant.
- Neutral surfaces, one confident brand colour for primary actions, semantic colours only for status.
- Numbers are the hero: large, tabular, high contrast.
- Flat surfaces with subtle borders; shadows only for overlays (sheets, dialogs, menus).

## 2. Tokens (default values — replace from templates)

### 2.1 Colour (semantic names; components never use raw hex)
| Token | Light | Dark | Use |
|---|---|---|---|
| `bg` | #F6F7F9 | #0F1216 | App background |
| `surface` | #FFFFFF | #171B21 | Cards, sheets |
| `surface-sunken` | #EEF0F3 | #0B0E12 | Inputs, table header |
| `border` | #D5D9E0 | #2A313B | Dividers, input borders |
| `border-strong` | #9AA3AF | #4A5463 | Focus-adjacent, Factory mode |
| `text` | #111827 | #F3F4F6 | Primary text |
| `text-muted` | #4B5563 | #A5ADB9 | Secondary text (still ≥ 4.5:1) |
| `primary` | #1F5FBF | #6EA4FF | Primary buttons, links, selection |
| `on-primary` | #FFFFFF | #0B1220 | Text on primary |
| `success` | #1E7D46 | #4CC27E | Saved, synced, pass |
| `warning` | #9A5B00 | #F2B33D | Soft warnings, low stock |
| `danger` | #B42318 | #FF7A6E | Errors, blocks, void |
| `info` | #0E6E8C | #5CC6E6 | Tips, offline info |
| `focus` | #F59E0B | #F59E0B | Focus ring (visible on all surfaces) |
| `practice` | #7C3AED | #A78BFA | Practice Mode banner/stripe |
Each status colour also has a `-subtle` background (≈ 8–12% tint) and must pass 4.5:1 for its
text on that background.

**Chart palette:** 6 categorical colours, colour-blind safe, distinguishable in greyscale by
order/labels; one sequential ramp (for stock matrix heat) and one diverging ramp (vs target).
Charts always use direct labels or a legend; never colour alone.

### 2.2 Typography
- Latin: **Inter** (or template font). Urdu: **Noto Nastaliq Urdu**. Numbers: Inter with
  `font-variant-numeric: tabular-nums` everywhere numbers align in columns.
- Self-host fonts (offline). Subset Urdu font to reduce size.
| Token | Size / line height (EN) | Urdu | Use |
|---|---|---|---|
| `display` | 32/40 | 34/56 | KPI hero numbers |
| `h1` | 24/32 | 26/44 | Screen titles |
| `h2` | 20/28 | 22/38 | Section titles |
| `body-lg` | 18/28 | 20/36 | Form inputs, key text on mobile |
| `body` | 16/24 | 18/32 | Default |
| `label` | 14/20 semibold | 16/28 | Field labels, chips |
| `caption` | 13/18 | 15/26 | Meta (who/when); never below 13 px |

### 2.3 Spacing, size, shape
- 4 px base grid; spacing scale 4, 8, 12, 16, 24, 32, 48.
- Touch: min 48 px; primary button 56 px; input height 56 px; list row ≥ 56 px.
- Radius: 8 (inputs, chips), 12 (cards, buttons), 16 (sheets). Full for pills/avatars.
- Border width 1 px (2 px in Factory mode and for focus).
- Breakpoints: `sm` < 600 (phone), `md` 600–1023 (tablet), `lg` ≥ 1024 (desktop).
- Max content width on desktop: 1280 px; forms max 640 px.

### 2.4 Motion
150–200 ms ease-out for enter, 120 ms for exit; no motion for data changes except a brief
highlight (1 s background fade) on newly added/changed rows. Disabled with reduced motion.

### 2.5 Iconography
One outline icon set (e.g. Lucide), 24 px, 2 px stroke. Every icon in a button has a text label
(icon-only only for universally known actions in toolbars, with `aria-label` and tooltip).
Custom icons for domain objects: carton, cone, cop, lot, machine, TFO, truck, scale.

## 3. Layout
- **Phone:** top app bar (title, sync indicator, language/profile) · content · sticky bottom
  action area for forms · bottom navigation (max 5: Home, Search, Stock, Reports/Dashboard, More).
- **Desktop:** left sidebar navigation (collapsible), top bar with global search (`/` shortcut),
  content in a 12-col grid; forms in a centred column; Register View full-width.
- **Practice Mode:** 6 px purple stripe at top + persistent banner "PRACTICE — not real data".
- **Offline:** non-blocking info bar under the app bar: "Offline. Your entries are saved on this
  phone and will sync automatically."

## 4. Components (each must document: anatomy, variants, states, a11y, RTL)
States for every interactive component: default, hover (desktop), pressed, focus-visible,
disabled (with reason tooltip/text), loading, error, success.

| Component | Key rules |
|---|---|
| **Button** | Variants: primary, secondary, tertiary (text), danger. Sizes 48/56. Loading shows spinner + verb ("Saving…"), keeps width. Only one primary per view. |
| **Big Action Tile** (Home) | Icon 32 px + label + optional count badge ("3 drafts"). Min 96 px tall, 2-column grid on phone. |
| **Text / Number Input** | Label always visible above (no placeholder-as-label). Unit suffix inside field. Helper text below. Error text replaces helper, with icon. Numeric keypad. Thousands grouping on blur, raw on focus. |
| **Stepper** | − [value] + for integers; long-press repeats; typed entry allowed. |
| **Weight Input** | kg with up to 3 decimals; shows derived values live ("= 0.991 kg/cone"); tolerance warning inline; "Read from scale" button when a scale is paired (Phase 3). |
| **Picker (Select/Combobox)** | Opens as bottom sheet on phone, popover on desktop. Search at top, "Recent" section, rich rows (lot: spec · supplier · stock). Archived items hidden unless toggled. Empty search → "No match. Add new?" (if permitted). |
| **Lot Line Editor** | For mixed lots: list of (lot, cones) rows, add/remove, running total vs total cones, mismatch shown inline. |
| **Date / Shift Selector** | Defaults to current business date + shift; quick chips "Today", "Yesterday"; backdating beyond allowed window disabled with explanation. |
| **Scan Button** | Opens camera QR/barcode scanner; on success vibrates + fills field; manual entry fallback always visible. |
| **Confirmation Summary** | Plain-language sentence + key numbers in large type + "Edit" + "Confirm & Save". |
| **Toast / Snackbar** | Bottom, 6 s, includes Undo when applicable; never the only place important info appears. |
| **Banner** | Info/warning/error/practice/offline; dismissible only if non-critical. |
| **Dialog** | Only for destructive confirmation and blocking choices. Restates consequence; requires reason for void/reopen/lock. |
| **Bottom Sheet** | Pickers, filters, quick details on phone. Drag handle + close button. |
| **Status Chip** | Icon + text + colour: Synced, Waiting, Needs attention, Voided, QC Hold, Closed, Draft. |
| **Sync Indicator** | Header; states listed in 02 §7; tap → Sync Center. |
| **Card** | Title, primary number, secondary meta, optional chevron for drill-down. |
| **KPI Tile** | Label, value (display size), unit, delta vs 7-day avg with arrow + text ("▲ 12% vs usual"), sparkline optional, tap → detail. Shows "—" with reason when no data. |
| **Data Table / Register Grid** | Sticky header & first column; tabular numbers right-aligned (left in RTL logic handled by `text-align: end`); zebra optional; row tap → detail; inline add row at bottom; keyboard navigation; column chooser; totals row; virtualised. On phone, rows collapse into cards unless the user opens Register View in landscape. |
| **Filter Bar** | Chips for active filters with ✕; "Filters" opens sheet; "Clear all"; filters persisted. |
| **Timeline** | Vertical events for lot/carton/order history; each event shows icon, what, qty, who, when, serial link. |
| **Empty State** | Illustration-free or simple icon, one sentence on why empty, one primary action ("Record first receipt"). |
| **Skeleton** | For lists/cards while loading; replaced by text message if > 3 s. |
| **Charts** | Line (trends), bar (by machine/shift/customer), stacked bar only when parts sum to a meaningful whole, heat-matrix (stock Count × Content). No pie charts with > 4 slices; no 3D; axes start at zero for bars; direct labels; tap shows value tooltip; every chart has a "View as table" toggle. |

## 5. Content style (microcopy)
- Short, direct, verb-first buttons: "Save entry", "Issue cartons", "Send to WhatsApp".
- Use "you"; avoid jargon from software (no "submit", "record created", "sync conflict").
  Use factory words.
- Numbers with units; dates in factory format; names of people on records.
- Urdu copy written natively (not word-for-word translation) and reviewed by factory staff.

## 6. Data-display conventions
- kg: up to 3 decimals in entry and registers (`285.415 kg`), 0–1 decimals in dashboards
  (`285.4 kg`, `12.6 t` for totals ≥ 10,000 kg with tooltip showing exact).
- Percentages 1 decimal. Deltas always signed with arrow and word.
- Zero shown as `0`, missing as `—` with a tooltip/reason, never blank.
- Negative stock is impossible; if displayed due to data issue, show in danger colour with
  "Needs check" chip and link to the Sync Center/Attention panel.
