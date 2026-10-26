---
name: Yarnflow
description: Cone Code. One white sheet flowing out of an ink sidebar; every material keeps its cone-tube colour wherever it appears, and every screen names its next step.
colors:
  ground: "#f5f4f2"
  panel: "#ffffff"
  raised: "#fafaf9"
  sunken: "#eeece8"
  line: "#e5e1db"
  line-strong: "#d1cbc2"
  control: "#8c837a"
  ink: "#1d1b19"
  ink-hover: "#3a3632"
  ink-2: "#5f5851"
  ink-3: "#6f675f"
  rail: "#1d1b19"
  rail-ink: "#d8d2ca"
  rail-muted: "#a39b91"
  rail-line: "#34302c"
  kraft: "#b98a5c"
  kraft-shadow: "#7d5a38"
  focus: "#2f6fd6"
  ok: "#1d6b3e"
  ok-bg: "#e6f3ea"
  warn: "#7f4d00"
  warn-bg: "#fff1d6"
  bad: "#a8201a"
  bad-bg: "#fde6e3"
  tube-blue: "#2f6fd6"
  tube-pink: "#c2417f"
  tube-teal: "#0f8a8a"
  tube-charcoal: "#4a4540"
  tube-sienna: "#a4502a"
  tube-slate: "#5b6b7a"
typography:
  display:
    fontFamily: "Figtree Variable, Figtree, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "34px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.025em"
    fontFeature: "tnum"
  headline:
    fontFamily: "Figtree Variable, Figtree, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.1
    letterSpacing: "-0.02em"
    fontFeature: "tnum"
  title:
    fontFamily: "Figtree Variable, Figtree, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-0.015em"
    fontFeature: "tnum"
  figure:
    fontFamily: "Figtree Variable, Figtree, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
    fontFeature: "tnum"
  body:
    fontFamily: "Figtree Variable, Figtree, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
    fontFeature: "tnum"
  label:
    fontFamily: "Figtree Variable, Figtree, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "15px"
    fontWeight: 600
    lineHeight: 1.3
    fontFeature: "tnum"
  meta:
    fontFamily: "Figtree Variable, Figtree, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.4
    fontFeature: "tnum"
rounded:
  control: "12px"
  row: "16px"
  field: "24px"
  sheet: "28px"
  pill: "999px"
spacing:
  xxs: "4px"
  xs: "8px"
  sm: "12px"
  md: "16px"
  lg: "20px"
  xl: "24px"
  field: "28px"
  xxl: "32px"
  section: "40px"
  page: "48px"
components:
  button-primary:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-primary-hover:
    backgroundColor: "{colors.ink-hover}"
    textColor: "{colors.panel}"
  button-secondary:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    typography: "{typography.label}"
    rounded: "{rounded.pill}"
    padding: "0 22px"
    height: "48px"
  button-secondary-hover:
    backgroundColor: "{colors.raised}"
  button-disabled:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.ink-2}"
  input:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
    height: "48px"
  sheet:
    backgroundColor: "{colors.panel}"
    rounded: "{rounded.sheet}"
    padding: "40px 48px 48px"
  field:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.field}"
    padding: "{spacing.field}"
  next-step:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.field}"
    padding: "26px 30px"
  next-step-uninspected:
    backgroundColor: "{colors.warn-bg}"
  next-step-hold:
    backgroundColor: "{colors.bad-bg}"
  next-step-clear:
    backgroundColor: "{colors.ok-bg}"
  row:
    rounded: "{rounded.row}"
    padding: "14px"
  row-hover:
    backgroundColor: "{colors.ground}"
  sidebar:
    backgroundColor: "{colors.rail}"
    textColor: "{colors.rail-ink}"
    width: "240px"
    padding: "26px 16px 20px"
  nav-item:
    textColor: "{colors.rail-ink}"
    rounded: "{rounded.pill}"
    padding: "0 16px"
    height: "48px"
  nav-item-active:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
  qc-approved:
    backgroundColor: "{colors.ok-bg}"
    textColor: "{colors.ok}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "30px"
  qc-needs-inspection:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "30px"
  qc-hold:
    backgroundColor: "{colors.bad-bg}"
    textColor: "{colors.bad}"
    rounded: "{rounded.pill}"
    padding: "0 12px"
    height: "30px"
  confidence-high:
    backgroundColor: "{colors.ok-bg}"
    textColor: "{colors.ok}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  confidence-mid:
    backgroundColor: "{colors.warn-bg}"
    textColor: "{colors.warn}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  confidence-low:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.pill}"
    padding: "6px 12px"
  segments:
    backgroundColor: "{colors.ground}"
    rounded: "{rounded.pill}"
    padding: "5px"
  segment-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    rounded: "{rounded.pill}"
    padding: "0 20px"
    height: "46px"
  filter-chip:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink}"
    rounded: "{rounded.pill}"
    padding: "0 8px 0 16px"
    height: "46px"
  filter-chip-selected:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  step-done:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
    size: "30px"
  flow-node:
    backgroundColor: "{colors.panel}"
    textColor: "{colors.ink-3}"
    size: "64px"
  flow-node-stocked:
    backgroundColor: "{colors.ink}"
    textColor: "{colors.panel}"
  viewfinder:
    backgroundColor: "{colors.rail}"
    rounded: "{rounded.field}"
---

# Design System: Yarnflow

## Overview

**Creative North Star: "Cone Code"**

Spinning mills tell yarn apart by the colour of its cone tube. Yarnflow gives each material one tube colour, assigned by the order the material was added, and carries it to every place that material appears: the cone at the start of a batch row, its share of the mix bar, the head of its thread on Stock. Everything else stays quiet so that colour can do its job.

The shell is one continuous surface rather than a grid of boxes: an ink sidebar, and a single white sheet that curves out of it with a large rounded edge. Sections sit directly on the sheet, separated by generous space, not by bordered cards. Only the places that ask for input or hold an answer (forms, scan results, the connect step, the batch label, records) rest in a soft stone field. Work is presented as a flow the user can follow without thinking: every working screen opens with a tinted next-step field that names the one thing to do and carries its button; batches, scans and forms show where they are on a numbered step line; stock runs along a kraft thread through its four stages; movements are strung on a timeline thread grouped by day. Status is still said with a pale tint plus a word plus an icon, and figures stay in tabular Figtree. The world explicitly replaced a KPI-tile dashboard (icon-in-circle cards, lime on charcoal), the espresso/burnt-orange/gold "Mill at Golden Hour" system, and its own first boxed, 1px-bordered panel build; none survive in code.

Motion makes the flow feel alive without performing: each screen settles in from below in a short stagger, the mix bar grows in, the stock thread's dash keeps running toward dispatch, a white pill glides under the nav, buttons press in and their arrow leans forward, scan answers arrive in sequence, and a small loom weaves while a photo is analysed. Reduced motion removes all travel, including the running thread.

The native iOS app (`../ios/Yarnflow/YarnflowApp.swift`, `enum YF` and `ConeMark`) mirrors these tokens and the same cone drawing, now with capsule buttons, tags and nav and borderless 24pt continuous-corner panels; it is a mirror of this system, not a separate one.

**Key Characteristics:**
- One tube colour per material, carried everywhere that material appears.
- One white sheet curving out of an ink sidebar; sections without boxes; soft stone fields only where input or an answer lives.
- Every working screen names its next step in one tinted field; sequences are threads with nodes.
- Pills for everything pressable or tag-like; nested soft corners for surfaces.
- Figtree throughout, tabular figures everywhere.
- Status is always tint + word + icon; confidence is a tinted % pill.
- Settling, flowing motion; none under reduced motion.

## Colors

A neutral warm-stone workspace where hue is reserved for materials, state and focus.

### Primary
- **Cone Ink** (ink): text, the primary button, the selected segment and filter chip, done steps, stocked flow nodes, the newest timeline node. Hover lifts to **Warm Graphite** (ink-hover). There is no brand accent colour; ink is the action colour.

### Secondary
- **Kraft Tube** (kraft) with **Tube Shadow** (kraft-shadow): the cone's paper tube in the mark and app icon, the loom's warp threads, and the running dash of the stock thread. It is the world's material, used on drawn objects only, never on text or controls.

### Tertiary: material tube hues
- **Cone Blue** (tube-blue), **Dye Pink** (tube-pink), **Teal Lot** (tube-teal), **Charcoal Spun** (tube-charcoal), **Sienna** (tube-sienna), **Slate** (tube-slate): assigned in order of the material list (`materialHue` in `src/Cone.tsx`), cycling after six. They fill the cone, the segments of the mix bar, and the cone that heads each material's thread on Stock.

### Neutral
- **Stone Ground** (ground): the soft fields on the sheet (forms, scan results, records, the label panel), row hover fields, segment wells, the default next-step field and empty states. Open decision: the build uses #f5f4f2, amended one step from the contract's #f6f4f1 after the finish review; the user has not yet signed off on that change.
- **Panel White** (panel): the working sheet, and the inner blocks that sit inside a stone field (review list, print label, available-stock line, artwork discs). **Raised** (raised) for secondary button hover and file inputs; **Sunken** (sunken) for disabled buttons and fields and icon-button hover.
- **Warm Edge** (line) for inset row hairlines, thread tracks and disclosure rules; **Firm Edge** (line-strong) for secondary button and filter chip edges, unvisited step and node rings; **Control Edge** (control) for input borders.
- **Ink 2** (ink-2) secondary text and icons; **Ink 3** (ink-3) tertiary notes, chevrons and empty nodes.
- **Rail** (rail), **Rail Ink** (rail-ink), **Rail Muted** (rail-muted), **Rail Line** (rail-line): the sidebar, phone top bar, bottom nav, menu sheet, and the camera viewfinder.

### State
- **OK** (ok on ok-bg): QC approved, an all-clear next step, confidence at or above 80%, a passing verdict, scanner connected.
- **Warn** (warn on warn-bg): needs inspection (also as the next-step field), confidence 50 to 79%, flagged verdicts and spec warnings, info banners.
- **Bad** (bad on bad-bg): QC hold (also as the next-step field), errors, invalid fields, destructive text actions.
- **Focus** (focus): 2px focus outline and caret; also the instrument blue of the detector box and the loom weft. It shares its value with Cone Blue.

### Named Rules
**The Tube Colour Rule.** A material hue identifies a material and nothing else: cone, mix bar segment, the head of a material's thread. It never marks status, selection or an action. (The only shared value is Cone Blue as the focus/instrument blue, which predates the hue list and is recorded as such.)

**The Ink Action Rule.** The primary action is a near-black ink pill with white text, one per view. There is no orange, lime or brand-coloured button.

**The Pale Tint Rule.** State colour is a pale background with its dark same-hue text, never a saturated fill. A next-step field takes the tint of the state it resolves.

## Typography

**Display Font:** Figtree Variable (self-hosted via `@fontsource-variable/figtree`, falling back to -apple-system, Segoe UI, sans-serif)
**Body Font:** Figtree Variable
**Label/Mono Font:** none distinct; figures use `font-variant-numeric: tabular-nums` set on body.

**Character:** One friendly, plain geometric sans doing every job, made firm by weight (700 for headings and figures, 600 for labels and values) rather than by a second family.

### Hierarchy
- **Display** (700, 34px, 1.1, -0.025em; 28px under 900px): page titles. Welcome and loading titles sit at 32px.
- **Headline** (700, 30px, 1.1, -0.02em; 24px under 640px): the garment name that leads a scan answer. Batch titles sit at 28px; the Home next-step heading at 24px (20px on phones).
- **Title** (700, 22px, 1.25, -0.015em): section headings on the sheet. Subheadings, stock group names and empty-state titles sit at 19px.
- **Figure** (700, 26px; 20px compact and on phones): stage totals on the stock thread; units follow in 15px ink-2. Yarn count order uses 20px.
- **Body** (400, 16px, 1.5): running text, capped at 65ch in section intros and Help. Inputs use 17px; page subtitles 17px ink-2.
- **Label** (600, 15 to 16px): buttons, field labels, nav (16px; 13px in the bottom nav, 18px in the menu sheet), row names, values in fact lists.
- **Meta** (400, 14px): secondary row lines, dt labels, timestamps, units. Step labels and stage names use it at 600.

### Named Rules
**The Tabular Rule.** Every number in the app uses tabular figures and kg aligns right in its own column.

**The Sentence Case Rule.** Headings, labels and tags are sentence case at normal tracking; nothing is set uppercase or letter-spaced open.

## Layout

Desktop is an ink frame holding one sheet: a sticky 240px ink sidebar and, beside it, a white sheet with 28px rounded left corners. Content inside the sheet is capped at 1240px with 40px top and 48px side and bottom padding. A page heading row puts the title and subtitle left and the page's primary action right, 32px above content.

Home reads top to bottom as a flow: the Next up field, then Stock flow (four stage nodes on the thread), then two columns, Materials (mix bar and cone rows) beside a 400px Recent movements timeline. Sections are 52px apart, columns 56px apart. Batch detail is a main column plus a 340px sticky label field, 48px apart; Settings and the fabric scanner split into two equal columns 40 to 56px apart. Forms cap at 820px; the scan step line at 760px; the form step marker at 420px.

Rhythm runs on 4px steps: 8, 12, 16, 20, 24, 28, 32, 40, 48. Sections sit 40px apart on the sheet; fields pad 28px (20px under 640px); rows are 14px padded with an inset hairline between them, never cards.

Breakpoints: at 1100px all two-column layouts stack and the label field stops being sticky. At 900px the sidebar becomes a sticky 60px ink top bar with a menu button; the content becomes a white sheet with 24px top corners over the ink, and a fixed five-item ink bottom nav with 24px top corners carries the same gliding pill; a right-hand ink menu sheet holds the rest. At 640px the stock thread turns vertical (stages read top to bottom with figures right), the next-step field's buttons drop to a full-width row, QC tags drop under row names, segmented controls become a full-width three-up grid, and primary scan buttons go full width. Touch targets are at least 44px (46 to 48px for buttons, chips, segments and inputs; 52px for choice pills; 54px for menu items and disclosure rows). Safe-area insets are honoured on the top bar and bottom nav.

## Elevation & Depth

No shadows anywhere in the system. Depth is three tonal planes: the ink rail as the frame, the white sheet curving out of it, and soft stone fields resting on the sheet where input or an answer lives; inside a field, white inner blocks step back up. Panels carry no border. Lines remain only where they mean something: control edges on inputs and secondary pills, inset hairlines between rows, and the threads that connect a sequence. Overlays (camera progress, live label, menu-sheet backdrop) are translucent ink (rgb(29 27 25) at 78%, 84%, 45%); the next-step icon sits on a 75% white disc over its tint.

### Named Rules
**The Tone Not Box Rule.** Separate by space and tonal plane, never by a bordered card or a shadow. A section on the sheet has no container; a stone field marks the one place that needs input or holds a result.

## Shapes

Soft, nested and continuous. Corners step down with size: the sheet and the phone menu sheet at 28px; fields, the next-step field, viewfinders and empty states at 24px (phone sheet and bottom nav tops too); rows, banners, verdict strips, inner review blocks and photos at 16px; inputs and selects at 12px. Everything pressable or tag-like is a full pill: buttons, nav items, segments and their well, filter chips and count badges, choice tiles, QC tags, confidence chips, the model badge and the mix bar. Circles are nodes: step markers (30px), stock flow nodes (64px, 48px compact), timeline nodes (40px), the next-step icon disc (56px), and the scan artwork discs. Threads are 2 to 3px round-capped lines joining nodes. The viewfinder carries four 30px white corner brackets, 3px stroke, with 10px rounded outer corners; the detector box keeps a small 6px corner. The recurring silhouette is the cone itself: a tapered, cross-wound cone on a kraft tube, drawn in code at 16x24.

### Named Rules
**The Thread Rule.** Anything that happens in order is strung on a thread: stock stages, batch lifecycle, scan and form steps, movements by day, a material's batches. Done and current nodes are ink; what is still ahead is an open firm-edge ring.

## Components

### Buttons
Soft, firm and tactile pills.
- **Shape:** full pill, 48px tall, 22px side padding, 600 16px label, optional leading 18px icon and trailing arrow.
- **Primary:** ink fill, white text; hover warm graphite and the trailing arrow leans 3px forward.
- **Secondary:** white with a firm edge; hover raised fill and control-grey edge.
- **Press:** scale 0.97 over 160ms on the ease-out curve (icon buttons 0.94; photo tabs 0.98). Hover styles apply only on fine pointers.
- **Disabled:** sunken fill, ink-2 text, not-allowed cursor.
- **Text button:** underlined ink, firm-edge underline that darkens to currentColor on hover; 36px tall.
- **Icon button:** 44px circle, transparent, sunken on hover.

### Chips
- **Filter chips (Stock views):** white pills with a firm edge, icon + label + stone count badge; pressed state turns ink with white text and a graphite badge.
- **Segmented control (Scan modes):** stone pill well with 5px padding; the selected segment is an ink pill with white text. Photo tabs use the same well, selected white, with a numbered disc that turns ink.
- **Choice pills (Yarn count):** 52px pills with a firm edge; checked gets an ink edge and a stone fill.

### Cards / Containers
There are no cards. Sections sit on the sheet with a 22px title row and 18px gap to content.
- **Field:** stone ground, 24px corners, 28px padding (20px on phones), no border, no shadow. Used for forms, scan results, the scan connect step, the batch label panel, the yarn count result and records.
- **Inner block:** white, 16px corners, inside a field (review list, print label, available stock).

### Inputs / Fields
- **Style:** white, 1px control-grey edge, 12px corners, 48px tall, 17px text, 14px side padding; label above at 600 15px with 8px gap. File inputs are dashed on raised with a pill selector button.
- **Focus:** 2px focus-blue outline flush to the field and a blue border.
- **Error / Disabled:** bad-red border plus an icon-led message line; disabled fields go sunken.

### Navigation
- **Sidebar:** ink rail 240px; brand row (cone + "yarnflow." 700 24px white), factory name and role over a rail-line rule, then Home (house), Stock (cone icon), Scan (scan-search), History (history) with Settings and Help (circle-help) pushed to the foot. Items are 48px pills, 600 16px rail ink with 22px icons and 14px gap; hover #2a2724 with white text.
- **Active:** a white pill with ink text. The pill is one shared element that glides to the current item over 260ms on cubic-bezier(0.23,1,0.32,1); the item turns white as it arrives.
- **Phone:** sticky ink top bar with brand and menu button; fixed five-item ink bottom nav (icon over 13px label, 58px tall) with the same gliding pill; the menu sheet is a right-side ink dialog with 28px left corners that slides in over 300ms on cubic-bezier(0.32,0.72,0,1) with a translucent ink backdrop.

### Icons
Lucide line icons, 18 to 24px, with two mill objects drawn in the same line style (24 grid, 1.75 stroke) where Lucide has none: the **Cone icon** for Stock and the **Cop icon** for the cops stage (`src/icons.tsx`). Stages read Package (raw), Factory (work in progress), PackageCheck (finished), Cop (cops); movements read arrow-down-to-line (receive), arrow-right-left (transfer), truck (dispatch), trash (waste), undo (reverse). Every icon sits beside a word or carries an accessible name.

### Next-step field (signature)
One tinted field at the top of Home and under the batch lifecycle: a 56px icon disc (48px inline, white at 75%, icon in the state's dark colour), a heading naming the single next action, a reason line in ink-2, and the action pill on the right. Tint follows the state it resolves: warn for inspection, bad for a QC hold, ok when all is clear, stone otherwise. Home pairs its primary action with a secondary Scan fabric pill.

### Steps
A numbered line of 30px rings joined by 2px connectors (26px on phones). Done steps are ink discs with a check and an ink connector; the current step has an ink ring and ink label with a 4px ground halo; steps ahead are firm-edge rings with ink-3 labels. Used for the batch lifecycle (Received, Inspected, QC approved, In production, Finished, Dispatched), the four-step scan line (Photograph, Care label optional, Analyse, Answer) and the two-step form marker (Details, Review and save). Colour and fill transition over 300ms.

### Stock flow
Four stage nodes (64px circles; 48px compact on batch detail) on a horizontal thread: a warm-edge track with a kraft dash (12 on, 16 off) that runs continuously toward dispatch. Nodes holding stock are ink with a white icon; empty ones are white with a firm-edge ring. Under each: stage name (600 14px), kg figure, carton count. On phones the thread turns vertical.

### Rows
Material and batch rows break out 14px into the margin so their 16px hover field aligns with the text: cone (28px), name and batch line, QC tag, kg right-aligned, chevron. An inset hairline starts at the text, not the edge, and disappears around a hovered row; the chevron leans 3px forward. Above the Materials rows, a 10px pill mix bar splits stock by tube colour with 3px gaps and grows in from the left.

### Timeline
Movements and inspection notes strung on a 2px vertical thread through 40px nodes holding the movement icon; the newest node is ink. Each item: action and batch (600), cone + route or note line (14px ink-2), kg and time on the right. In History, day labels (Today, Yesterday, or a date; 700 15px ink-2) sit on the thread between their movements.

### Stock groups
Each material is headed by its 36px cone, name (700 19px), batch count and total kg; its batches hang from a 2px thread below the cone, each row marked by a 12px open bead that turns ink on hover.

### QC tag
30px pill, 600 14px: pale tint + word + 16px icon. Approved (ok, check circle), Needs inspection (warn, clipboard), QC hold (bad, warning triangle). Never colour alone.

### Cone Mark
The cross-wound cone on its kraft tube (`src/Cone.tsx`): yarn body in the material's tube colour with faint white crossing winds at 22% opacity. It opens every batch and movement row, heads each Stock group, and leads the batch title at 44px; the brand mark and app icon (`public/icon.svg`, `public/brand/logo.png`) are the same drawing in Cone Blue on ink.

### Scan answer
In a stone field: a garment hero (112px white artwork disc, garment name as headline, confidence pill right) over a firm hairline, then rows for fabric, made of, blend and finish, each a 64px artwork disc or icon, label and value, and a confidence pill: 700 18px % on green (at or above 80%), amber (50 to 79%) or white (below 50%). Hero, rows and verdict settle in with the 420ms entrance, 60ms apart; then a 16px-cornered tinted verdict strip, action pills, and a Details disclosure holding alternatives, the analysed photo with its focus-blue detector box, and timings.

### Viewfinder and loom loader
The camera sits in an ink 4:3 viewfinder (16:9 for labels) with 24px corners, white corner brackets and a translucent "live" pill with a green dot. While analysing, an ink overlay shows the loom: kraft and white warp threads lifting in turn while a blue weft shuttles across, 1.6s loops.

### Floating artwork
Garment and fabric cut-outs drift on a 4.2s ease-in-out float (rotate -12 to -8deg, rise 4%) inside their disc; static under reduced motion.

## Do's and Don'ts

### Do:
- **Do** give every material its tube colour from `materialHue` and show the cone wherever the material is named in a row or header.
- **Do** open every working screen with one next-step field: the single next action, its reason, and its ink pill, tinted by the state it resolves.
- **Do** show any sequence (stages, lifecycle, scan, form, movements, a material's batches) as nodes on a thread; done and current in ink, ahead as open rings.
- **Do** keep the primary action an ink (#1d1b19) pill, one per view.
- **Do** say status as pale tint + word + icon, and confidence as a tinted % pill: green at or above 80%, amber at or above 50%, white below.
- **Do** separate sections by space on the white sheet and put input or answers in a 24px stone field; nest corners 28 / 24 / 16 / 12 and make pressables and tags pills.
- **Do** set every figure in tabular Figtree and right-align kg in its own column.
- **Do** keep motion to the established set: 480ms settle with 70ms stagger, 900ms mix bar grow, 1.4s running thread, 260ms pill glide, 0.97 press over 160ms, 3px arrow lean, 60ms-staggered scan answers, 300ms drawer sheet, loom loader, 4.2s artwork float; remove travel under reduced motion.
- **Do** keep hit targets at 44px or more and hover styles behind `(hover: hover) and (pointer: fine)`.

### Don't:
- **Don't** use a material hue for status, selection or a button.
- **Don't** wrap sections in bordered cards or add shadows, glows or gradients to surfaces or buttons.
- **Don't** build KPI tiles (a figure in a card with an icon in a tinted circle), or bring back lime-on-charcoal or espresso/orange/gold chrome; circles are nodes on a thread or the next-step mark, nothing else.
- **Don't** introduce a second typeface for display or labels, or set labels uppercase with open tracking.
- **Don't** signal state with colour alone.
