# Calm UI finish verdict

Date: 25 October 2026

**Disposition: ship — for the seven listed fixes only.** All seven are resolved. No required capture needs replacement. This independent verdict pass scores the prior review's listed findings; it is not a new defect hunt, a review of all 434 screenshots, or whole-app approval.

The user's brief and `docs/design-direction.md` govern the assessment: readable text, 4.5:1 minimum contrast including disabled text, discoverable tasks for novice mill staff, plain verb-led actions, sentence case, and readable mixed English/Urdu content. No application source was changed during this verdict pass.

| Listed finding | Score | Evidence and reasoning |
| --- | --- | --- |
| Disabled opacity reduced contrast to 2.92:1 | **Resolved** | The final disabled rules in `src/theme.css` use opacity 1, secondary text and an opaque subtle surface. Both required scanner captures visibly show readable disabled actions. `after/audit.json` contains 434 capture results and 96 visible disabled-control observations; the inspected scanner observations report opacity 1 and 5.68:1. This clears the brief's 4.5:1 threshold. |
| Offscreen table weight, status and actions had no mobile cue | **Resolved** | `ScrollTable` in `src/App.tsx` detects actual overflow using `ResizeObserver`, renders a bilingual instruction only when needed, and connects it to the focusable named region with `aria-describedby`. The 390px Stock and Today captures visibly say “Scroll across to see the remaining columns.” The Urdu Today capture has the translated cue. Desktop Today has no unnecessary cue where the full table fits. |
| “New batch” was a noun-led primary action | **Resolved** | `src/LiveApp.tsx` now renders “Create batch” when materials exist. The final audit also records the “Create batch” control. The empty-workspace action remains the appropriate “Add a material.” |
| Reports eyebrow and all-cap supporting labels | **Resolved** | The required Reports capture starts directly with “Reports”; the prior eyebrow is absent. `src/ui-copy.ts` contains sentence-case “Practice data” and “Composition from the label.” |
| Latin yarn specifications reordered in Urdu | **Resolved** | Relevant yarn specifications in `src/App.tsx` use `<bdi dir="ltr">`. The English and Urdu Today captures were viewed at their original 390px width. The Urdu recent-entry rows visibly retain “20/1 Cotton Combed”, “30/1 CVC 60/40” and “50D/24F 1244 TPM Z” in the intended order. |
| Chart target annotation overlapped the 3,000 tick | **Resolved** | `src/workspace.css` places the target annotation 8px inside the plot and 8px above its line. Desktop and mobile Today captures show the target word separated from the 3,000 axis value and the 2,847 bar value. |
| Invalid scanner/offline capture position and mislabeled order review | **Resolved** | `.qa/calm-check.mjs` blurs an active skip link, scrolls to the document top, and captures before axe analysis can alter focus/scroll. It fills the required order fields and waits for “Check before saving” before capturing the review. The required scanner captures visibly include the top bar and Material scanner heading. The order capture visibly shows Step 2 of 2, the entered summary and Save order. The same capture reset applies to offline states; offline images were not separately reinspected in this limited pass. |

## Images inspected

All files below are in `docs/progress/calm/after/`. Dimensions were read from the PNG headers. Each was opened using `view_image`; the English/Urdu mobile overviews and the desktop/review images were also inspected at original resolution.

| File | Actual dimensions |
| --- | --- |
| `register-overview-390.png` | 390 × 3554 |
| `register-overview-390-urdu.png` | 390 × 3747 |
| `register-inventory-390.png` | 390 × 1886 |
| `live-scanner-fabric-390.png` | 390 × 2971 |
| `live-scanner-spec-1440.png` | 1440 × 1481 |
| `register-order-review-390.png` | 390 × 1000 |
| `register-reports-1440.png` | 1440 × 1020 |
| `register-overview-1440.png` | 1440 × 2210 |

## Supporting evidence and limits

The inspected final audit has 434 result rows, zero capture errors, and zero recorded axe violations, document overflow, undersized measured text/controls, forbidden purple/gradients, type-scale violations or nested glass. These are supporting automated observations, not a substitute for visual review or a claim of whole-app usability. The disabled contrast calculation is a local computed-style measurement; it does not certify every possible background/state.

The parent implementation report records 14 Chromium/WebKit end-to-end passes, including review/save/Undo/reversal, 38 unit/API passes, and an empty design-detector result. Those suites were not rerun by this verdict pass. No score is assigned here to the later prose-link target change or any other unlisted work. This pass also does not certify physical camera behavior, low-end factory-device scrolling, field performance, translation quality, or comprehension by actual mill staff.
