---
name: Yarnflow
description: Calm factory work on warm cotton surfaces with deep teal actions.
colors:
  page: "#f7f6f3"
  card: "#fff"
  sunken: "#f1efea"
  border: "#e4e1da"
  input-border: "#858780"
  text-primary: "#1b1d1f"
  text-secondary: "#5a5e63"
  brand: "#0f5f6b"
  brand-hover: "#0b4c56"
  brand-light: "#e6f0f1"
  brand-mid: "#b9d3d6"
  on-brand: "#fff"
  success: "#1f7a45"
  success-surface: "#e8f4ec"
  warning: "#9a5600"
  warning-surface: "#fff3df"
  error: "#b42b24"
  error-surface: "#fdebea"
  glass-fill: "rgb(255 254 250 / 92%)"
  glass-solid: "#fffefa"
  glass-edge: "rgb(255 255 255 / 80%)"
  dark-page: "#171c1c"
  dark-card: "#222929"
  dark-sunken: "#2c3433"
  dark-border: "#46514e"
  dark-input-border: "#8d9994"
  dark-text-primary: "#f5f4ef"
  dark-text-secondary: "#c1c7c3"
  dark-brand: "#95d2d7"
  dark-brand-hover: "#b5e1e4"
  dark-brand-light: "#253f41"
  dark-brand-mid: "#42676a"
  dark-on-brand: "#132527"
  dark-success: "#a1dbb8"
  dark-success-surface: "#233d2c"
  dark-warning: "#f4cf8c"
  dark-warning-surface: "#44351e"
  dark-error: "#ffb3aa"
  dark-error-surface: "#482d2b"
  dark-glass-fill: "rgb(34 41 41 / 94%)"
  dark-glass-solid: "#222929"
  dark-glass-edge: "rgb(220 230 222 / 18%)"
typography:
  headline:
    fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "32px"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "20px"
    fontWeight: 600
    letterSpacing: "-0.01em"
  register-title:
    fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "24px"
    fontWeight: 600
    lineHeight: 1.3
  control:
    fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "18px"
    fontWeight: 500
  body:
    fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "16px"
    fontWeight: 500
  supporting:
    fontFamily: '"IBM Plex Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif'
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  urdu:
    fontFamily: '"Noto Nastaliq Urdu", "IBM Plex Sans", sans-serif'
    fontWeight: 400
rounded:
  status: "4px"
  control: "8px"
  card: "10px"
  register-panel: "12px"
  glass-control: "16px"
  phone-register-tab: "20px"
  glass-panel: "24px"
spacing:
  space-1: "4px"
  space-2: "8px"
  space-3: "12px"
  space-4: "16px"
  space-6: "24px"
  space-8: "32px"
  space-10: "40px"
  space-12: "48px"
components:
  button-primary:
    backgroundColor: "{colors.brand}"
    textColor: "{colors.on-brand}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  button-primary-hover:
    backgroundColor: "{colors.brand-hover}"
    textColor: "{colors.on-brand}"
  button-secondary:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text-primary}"
    typography: "{typography.control}"
    rounded: "{rounded.control}"
    padding: "12px 16px"
  button-disabled:
    backgroundColor: "{colors.sunken}"
    textColor: "{colors.text-secondary}"
  input:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.control}"
    padding: "12px"
  nav-active:
    backgroundColor: "{colors.brand-light}"
    textColor: "{colors.brand}"
    typography: "{typography.control}"
    rounded: "{rounded.glass-control}"
    padding: "12px 16px"
  status-approved:
    backgroundColor: "{colors.success-surface}"
    textColor: "{colors.success}"
    rounded: "{rounded.status}"
    padding: "4px 8px"
  status-warning:
    backgroundColor: "{colors.warning-surface}"
    textColor: "{colors.warning}"
    rounded: "{rounded.status}"
    padding: "4px 8px"
  status-hold:
    backgroundColor: "{colors.error-surface}"
    textColor: "{colors.error}"
    rounded: "{rounded.status}"
    padding: "4px 8px"
  card:
    backgroundColor: "{colors.card}"
    textColor: "{colors.text-primary}"
    rounded: "{rounded.card}"
    padding: "24px"
---

# Design System: Yarnflow

## Overview

**Creative North Star: "The Calm Factory Register"**

Yarnflow brings the confidence of a familiar paper register to a shared factory workspace. Warm cotton neutrals carry the work; deep teal identifies the next action, the current place and the data. Premium means calm, clear and confident for mill staff moving between office desktops and factory phones.

Solid working surfaces sit beneath one restrained layer of floating glass. Large readable text, steady alignment and quiet state changes make each task predictable. Use plain factory wording, meaningful icons and recoverable forms; decoration must never compete with quantities, batch names or decisions.

This is a code-led capture of the implemented system, grounded in the user's complete 25 October 2026 brief, `PRODUCT.md`, `docs/design-direction.md`, `src/theme.css`, `src/live.css` and `src/workspace.css`. No approved visual comp is implied. `src/main.tsx` loads the shared theme last. The shared workspace is the default; the separate register interface at `/?practice=1` shares the visual language. Screenshot acceptance and the final capture matrix are separate verification work; this document does not certify a final review pass.

**Key Characteristics:**
- Warm cotton surfaces and a single deep teal brand accent.
- Large text, tabular figures and clearly labelled controls.
- Opaque content beneath restrained floating glass.
- Spacious alignment with quiet row dividers.
- Word, icon and color together for status.

## Colors

The palette feels like clean cotton paper, dark ink and deep teal machinery: neutrals dominate, actions remain distinct, and status colors retain their meaning.

### Primary
- **Deep Teal** (`brand`): primary actions, active navigation, links, focus and chart data. `brand-hover` strengthens pointer feedback; `brand-light` marks selection; `brand-mid` supports secondary data marks.
- **On Teal** (`on-brand`): readable text on a filled primary action. Use the semantic token so dark mode also receives the correct foreground.

### Neutral
- **Warm Cotton** (`page`): the application canvas.
- **Clean Paper** (`card`): solid content, tables, fields and form interiors.
- **Pressed Cotton** (`sunken`): quiet grouping, hover and disabled backgrounds.
- **Paper Edge** (`border`): dividers and surface boundaries; it is not the field-recognition stroke.
- **Register Stroke** (`input-border`): stronger edges for inputs and secondary controls.
- **Factory Ink** (`text-primary`) and **Secondary Ink** (`text-secondary`): primary and supporting text. Supporting text remains readable rather than faint.
- **Warm Glass** (`glass-fill`, `glass-solid`, `glass-edge`): floating chrome and its opaque fallback. High opacity is intentional to protect readability over scrolling content.

### Status
- **Inspection Green** (`success`, `success-surface`): approved or confirmed states.
- **Attention Amber** (`warning`, `warning-surface`): pending inspection, offline and attention states.
- **Hold Red** (`error`, `error-surface`): QC hold, invalid input, errors and destructive recovery actions.

The `dark-` frontmatter entries record the actual dark theme equivalents. Runtime CSS retains the same semantic custom-property names and changes their values under `data-theme="dark"`; consumers should use those properties rather than selecting raw light colors. The factory theme currently shares the light palette. No inferred color ramp is normative.

**The Meaningful Color Rule.** Use teal for action, selection, links, focus and data; use green, amber and red for status. Let neutral surfaces occupy most of the screen.

## Typography

**Display and Body Font:** IBM Plex Sans with the system fallback stack in the frontmatter. The app self-hosts its Latin weights through Fontsource.

**Urdu Font:** Noto Nastaliq Urdu, falling back to IBM Plex Sans and sans-serif. The Urdu root selects this family; use logical positioning and allow extra text height.

**Character:** Direct, workmanlike and calm. Numerals are tabular throughout. Normal interface identifiers use the body family, and dates and quantities use readable localized formatting.

### Hierarchy
- **Headline:** the page title; tighter leading and slight negative tracking distinguish it without color decoration.
- **Title:** shared workspace section headings. Register section headings use the larger `register-title` role; shared subsection headings can use the control size.
- **Control:** action labels and navigation. Input text uses the same size with normal text weight.
- **Body:** descriptions, table content and records. Explanatory panel text is bounded to about (65ch) where present.
- **Label:** visible field names in medium weight.
- **Supporting:** helper text, timestamps, chart labels and status labels.
- **Figures:** primary desktop quantities use the headline size and tighter leading; phone summaries step down to the register-title size.

The implemented reusable sizes are the six Latin sizes represented above. The brief also permits a larger (40px) step, but it is not extracted as a current role. Use only weights (400), (500) and (600).

**The Readable Register Rule.** Body text starts at (16px), controls at (18px), and supporting text never falls below (14px). Build hierarchy with type, weight and space before adding containers.

## Layout

Use the extracted spacing scale for padding and gaps. Desktop chrome is inset (16px); sidebars are (240px) wide, and the main shell begins at (272px). Main areas align headings, summaries, lists and form edges to a common grid.

The shared workspace has a centered content maximum of (1240px), with desktop shell gutters of (24px), content inset of (8px), and top content padding of (40px). The separate register main area uses a maximum of (1440px), padding of (32px 24px), and wider (40px) gutters above its large-screen breakpoint. These are observed surface variants, not interchangeable page templates.

At (1100px) the shared workspace reduces summary columns and stacks batch details; at (760px) it replaces the sidebar with a five-destination bottom bar, uses (16px) outer gutters and (16px) panel padding, and stacks action groups. Its desktop fields use three columns; smaller screens retain two numeric columns with the main weight field spanning the row. At (560px) review facts become a single column. Preserve bottom safe-area space and keep content clear of fixed navigation.

The register shell switches to bottom tabs at (900px), simplifies further at (600px), and uses (16px) narrow-screen gutters. Its summary panels and ordinary table rows retain shared alignment. Table content scrolls within its own region; a visible instruction makes offscreen columns discoverable before entry.

**The Same Grid Rule.** Align headings, content and primary actions. Separate sections with whitespace and quiet dividers rather than wrapping every item in a box.

## Elevation & Depth

Content is flat and opaque at rest. Working panels have a light border and no card shadow. Floating navigation, top bars, phone bars, dialogs, sheets, popovers and segmented controls may use a single glass layer. Dialog form interiors remain opaque, and nested switches use the solid subtle surface. A standalone floating task control may use this same chrome material when present; do not add a second visual treatment.

### Shadow Vocabulary
- **Floating chrome:** the light glass uses a soft neutral drop shadow (`0 8px 24px rgb(27 29 31 / 8%)`) and an inset top highlight (`inset 0 1px 0 rgb(255 255 255 / 85%)`). Dark equivalents are recorded in the sidecar.
- **Transient notice:** the register toast uses a very soft neutral shadow (`0 4px 16px rgb(0 0 0 / .08)`). Content cards remain shadowless.

Glass starts solid. Only a successful backdrop-filter feature query enables warm translucent fill with blur (24px) and saturation (170%), including the Safari prefix. Reduced transparency restores the solid material; reduced motion removes transitions, animations and smooth scrolling. Routine interaction feedback uses (150ms) color and border transitions. The implemented system does not require decorative motion or sliding selection effects. Loading rotation is functional progress feedback and stops under reduced motion.

**The One Glass Layer Rule.** Glass floats above opaque work. Never place glass inside glass, blur content, or add decorative backgrounds to display the effect.

## Shapes

Fields and ordinary buttons have modest control corners. Shared content uses the `card` radius; register panels use `register-panel`. Status tags use compact `status` corners. Floating shells use `glass-panel`, while their inset controls follow the capsule-like inner geometry represented by `glass-control`; the register phone tab has its observed `phone-register-tab` radius. Reserve these larger shapes for chrome.

Keep borders thin and neutral. Progress tracks and chart bars are square ended. Avoid nested framed cards; inner sections use space and dividers. Icons come from Lucide with a consistent stroke width (1.75); use them for navigation, status and recognizable actions.

## Components

### Buttons

Confident, plainly labelled actions. Primary buttons use teal and its on-brand foreground; secondary buttons use opaque paper with the stronger recognition border. Both use control corners and padding from the component tokens, with targets of at least (48px). Pointer hover changes fill and border; press uses a subtle brightness change. Keyboard focus is an offset (3px) semantic teal outline with (4px) separation. Disabled buttons keep fully opaque readable secondary text, a subtle surface and the stronger border. Use one verb-led primary action per task state.

### Inputs / Fields

Readable register entries with a visible label above the field. Fields are solid, use the stronger neutral border and control corners, and have internal padding (12px). Shared fields have a minimum height (52px); register fields have a minimum (48px). Placeholder color is supporting ink, not a replacement for a label. Focus uses the shared visible outline; invalid input pairs the error border with explanatory text and a meaningful icon. Preserve entered values and show a review summary before committing.

### Navigation

Floating chrome with visible words and useful icons. Desktop destinations form a vertical list with restrained spacing; active destinations receive a teal tint and `aria-current="page"`. Phone navigation has five visible destinations. Hover uses the subtle surface; keyboard focus remains visible. Use the larger chrome radii and solid fallback, including under reduced transparency. Nested segmented controls become opaque instead of stacking another blur layer.

### Chips / Status

Compact, informative labels rather than decoration. Approved, pending inspection and QC hold combine a readable word, a meaningful icon and the matching semantic foreground/background. Use the small status corners and compact padding. These are static status readouts, so their compact visible size does not define a touch target; interactive filters or actions still need the control minimum.

### Cards / Containers

Opaque working paper, lightly bounded and flat. Shared panels use the card token, padding (24px) on desktop and (16px) on phones. Register panels use their observed modest larger corner. Inner panels lose their own border and radius. Empty states use a clear title, short explanation and the next real action; do not fabricate stock or add decorative illustrations. Tables use normal type, quiet dividers and neutral hover; chart marks use flat teal, light gridlines, direct values and a zero baseline.

The sidecar contains five framework-free HTML/CSS examples: a primary button, labelled field, floating navigation, meaningful status tag and solid panel. Their CSS custom properties inherit the active theme; inline SVG carries icons without a runtime library. They illustrate appearance and semantic structure, not application behavior or a completed acceptance audit.

## Do's and Don'ts

### Do:
- **Do** use warm cotton neutrals for the canvas, solid paper for work and teal for meaningful actions.
- **Do** keep body text at least 16px, controls 18px, supporting text at least 14px and interactive targets at least 48px.
- **Do** pair each status with words, a meaningful icon and its semantic color.
- **Do** preserve visible focus, readable disabled states, reduced motion and solid glass fallbacks.
- **Do** align sections, use tabular numbers and show human-readable dates and quantities.
- **Do** keep form labels, inline recovery and review-before-save patterns clear and consistent.

### Don't:
- **Don't** introduce violet, default blue, glows, heavy colored shadows or gradients outside the permitted glass edge highlight.
- **Don't** put glass on tables, charts, forms, inputs or reading surfaces, or stack glass layers.
- **Don't** add decorative illustrations, emoji, tinted icon tiles or badges without information.
- **Don't** turn every item into a pill or nest framed cards to create hierarchy.
- **Don't** use tiny uppercase eyebrow labels, colored headings, monospace record IDs or raw ISO dates in normal interface text.
- **Don't** treat a documented token or component example as proof that every route and state has passed final visual review.
