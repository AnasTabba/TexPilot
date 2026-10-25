---
name: "Yarnflow UI demo \u2014 provisional"
description: "Extracted warehouse UI concept awaiting user approval; scoped to ui-demo only."
colors:
  primary: "#d0ed82"
  primary-hover: "#bfdc70"
  primary-ink: "#2f3c1d"
  canvas: "#f5f6f2"
  surface: "#ffffff"
  sidebar: "#252720"
  featured: "#2e3428"
  ink: "#272b23"
  muted: "#69775a"
  line: "#e9ebe4"
  focus: "#789b38"
  approved-bg: "#edf4e5"
  approved-ink: "#49672e"
  pending-bg: "#fcf3e3"
  pending-ink: "#80591c"
  hold-bg: "#fceee9"
  hold-ink: "#8b4935"
typography:
  headline:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.35
    letterSpacing: "-0.035em"
  quantity:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "30px"
    fontWeight: 700
    lineHeight: 1.25
    letterSpacing: "-1.2px"
  title:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.4
    letterSpacing: "-0.25px"
  body:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "14px"
    fontWeight: 400
  label:
    fontFamily: "Manrope, -apple-system, BlinkMacSystemFont, Segoe UI, sans-serif"
    fontSize: "10px"
    fontWeight: 600
rounded:
  badge: "5px"
  control: "7px"
  field: "8px"
  card: "12px"
  panel: "13px"
  dialog: "15px"
spacing:
  xs: "8px"
  sm: "12px"
  md: "16px"
  gap: "18px"
  lg: "20px"
  xl: "24px"
components:
  button-primary:
    backgroundColor: "{colors.primary}"
    textColor: "{colors.primary-ink}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  button-primary-hover:
    backgroundColor: "{colors.primary-hover}"
  button-secondary:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.control}"
    padding: "10px 14px"
  panel:
    backgroundColor: "{colors.surface}"
    rounded: "{rounded.panel}"
  badge-approved:
    backgroundColor: "{colors.approved-bg}"
    textColor: "{colors.approved-ink}"
    rounded: "{rounded.badge}"
    padding: "5px 7px"
  badge-pending:
    backgroundColor: "{colors.pending-bg}"
    textColor: "{colors.pending-ink}"
    rounded: "{rounded.badge}"
    padding: "5px 7px"
  badge-hold:
    backgroundColor: "{colors.hold-bg}"
    textColor: "{colors.hold-ink}"
    rounded: "{rounded.badge}"
    padding: "5px 7px"
---

# Design System: Yarnflow UI demo

## Overview

**Creative North Star: "The Charcoal-and-Lime Warehouse"**

Provisional code-led UI concept, awaiting the user’s desktop and mobile review and approval. This document describes only the isolated `/ui-demo/` prototype; it does not approve a production rollout or replace the production design system.

The user-selected warehouse dashboard reference resolves the qualitative direction: charcoal olive navigation, a near-white workspace, clean white panels, restrained lime actions, and compact Manrope information. Fabric thumbnails connect quantities and QC states to materials; all stock and inspection results remain illustrative.

**Key Characteristics:**
- Compact warehouse information with tabular quantities.
- Lime selection and actions against charcoal navigation and white panels.
- Responsive stock lists and an interactive framed phone preview.

## Colors

### Primary
Lime marks selected sidebar destinations, the brand symbol and primary actions; its darker hover companion keeps the same character. Charcoal olive anchors navigation and the featured summary.

### Neutral
Near-white canvas separates white work surfaces. Ink carries headings and quantities; muted olive carries supporting copy; fine warm-gray lines divide rows and controls. The focus green is an interaction cue.

Approved, pending and held QC badges use separate soft green, amber and terracotta backgrounds with the extracted darker foregrounds. These semantic colors supplement explicit state text.

**The Lime Action Rule.** Use lime for primary actions and current navigation, as the prototype does. QC states retain their own text labels and semantic fills.

## Typography

**Display Font / Body Font:** Locally bundled Manrope with system sans-serif fallbacks. Regular, semibold and bold files supply the hierarchy; no distinct mono face is used.

The frontmatter records the default desktop hierarchy: page headline, summary quantity, panel title, root body and compact label. Most visible data and supporting text is compact (10–12px), with semibold controls (11px). The phone page headline is 24px; summary quantities are 29px. At wide desktop sizes, headings reach 30px and quantities 35px. Numeric totals and weights use tabular figures. The 42px presentation caption belongs only to the phone preview stage, not the application type scale.

## Layout

A fixed sidebar (216px) and white topbar (70px) frame the desktop workspace. Main content caps at 1510px with 30px side padding, four metric columns, and a roughly 1.95:1 chart/detail grid. Panel gaps use 16–18px; internal padding commonly uses 20–24px. At 1120px the sidebar narrows to 190px; between 701–850px it becomes 170px and dashboard sections stack. At 1500px the sidebar expands to 240px and main padding to 40px.

At 700px and below, the sidebar yields to a branded header and fixed four-destination bottom navigation. Main content uses 18px gutters and a 560px cap; metrics use two columns, work areas stack, and both inventory and recent-batch tables become list rows. Material identity stays left; quantity and QC status stay together on the right. Footer space clears the bottom navigation, which includes safe-area padding.

The demo’s device switch opens a real iframe inside a 390px phone frame (360px in the narrow presentation). The frame, camera and home indicator are review presentation, not application chrome.

## Elevation & Depth

White and lightly tinted surfaces, quiet borders and charcoal contrast provide ordinary depth. Popovers, dialogs, toast messages and the phone frame carry soft shadows. Exact overlay shadows and motion live in the sidecar.

**The Quiet Surface Rule.** Keep ordinary work panels flat; reserve pronounced shadows for overlays and the phone presentation frame.

## Shapes

Compact rounded controls and fields contrast with broader card and panel corners. QC badges use smaller corners; avatars and status dots are circular. Thin borders describe fields, dividers and work surfaces. The phone silhouette uses much larger corners exclusively for presentation.

## Components

- **Buttons:** Lime primary, white bordered secondary, charcoal review action and quiet text variants. Standard buttons have a 36px minimum height, inline Lucide icons, semibold labels, subtle background transitions and a 1px active press. Mobile receipt action becomes an icon button with its accessible name retained.
- **Inputs and filters:** White fields with fine olive-gray borders and 8px corners; search uses a grouped outline on focus. Filter tabs use a soft green selected fill and visible counts. Input, select and textarea focus uses the shared ring.
- **Cards and panels:** Flat white summaries and bordered work panels, with one charcoal featured summary. Panel headings align concise titles and supporting text with a select or icon action.
- **QC badges:** Explicit Approved, Pending QC and On hold labels, compact dots, semibold type and the corrected semantic foreground/background pairs. Phone list badges use smaller 9px labels.
- **Navigation:** Charcoal sidebar with lime current item on desktop; four fixed icon-and-label destinations on phone, with a soft green current-state backing. Buttons expose the current page accessibly.
- **Details and feedback:** Native dialog batch drawer with backdrop and close control; centered receipt dialog; status toast above phone navigation. Dispatch is visibly disabled for unapproved samples.
- **Inspection and charts:** Fabric photos anchor the simulated inspection, which exposes loading and uncertain-result states honestly. Chart points respond to pointer and keyboard focus; SVG summaries have accessible labels.

Focus is a visible 3px green outline with 3px offset; grouped search uses its own 2px outline. Default buttons transition for 180ms with the extracted easing. Reduced-motion preference collapses animations and transitions to 0.01ms and one iteration. Scanner motion and dialog reveals are documented as prototype behavior, not a new production requirement.

## Do's and Don'ts

### Do:
- **Do** keep quantities tabular and units visible.
- **Do** show QC text together with its color; retain the corrected status foregrounds.
- **Do** preserve keyboard focus and reduced-motion support.
- **Do** mark samples and simulated inspection results as illustrative.

### Don't:
- **Don’t** treat this provisional concept as approval to replace the production UI.
- **Don’t** hide mobile quantity or QC status behind horizontal table scrolling.
- **Don’t** imply that sample scanner results ran a trained model or approved real stock.
