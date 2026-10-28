# Yarnflow UI polish

Implemented locally on `feat/yarnflow-scanner-ux`, based on `e3c5898`. The shared workspace remains the default at `/`; the register interface remains at `/?practice=1`. No stock records were moved between them and no production sample records were added.

## Design and skills

The complete skill inventory, applicable rules and conflict decisions are recorded in [design-direction.md](../../design-direction.md). The user brief governs all choices: cotton neutrals, deep teal, IBM Plex Sans, readable fixed type, 48px targets and glass confined to floating chrome.

The main design contributors were Impeccable, UI/UX Pro Max, UI Design System, Senior Frontend, UX Researcher/Designer, Web Design Guidelines and Dataviz. Epic Design contributed bounded effects and reduced-motion safeguards. The six CRO skills contributed task clarity, form recovery, single-action hierarchy and empty-state progression. The remaining visual/artifact/scaffolding skills were checked for applicable principles without adding unrelated deliverables. Sites guidance was used for local preview only; Playwright and Full Page Screenshot principles govern the screenshot audit.

## Shared system

- Self-hosted IBM Plex Sans in weights 400, 500 and 600. Removed unused Inter dependency. Urdu retains Noto Nastaliq Urdu.
- One 14/16/18/20/24/32/40 type scale, tabular numbers, 16px body text and 18px form controls. Supporting text stays at least 14px.
- Warm neutral page and solid content surfaces; deep teal for primary actions, selection, links, focus and data. Status uses words, an icon and its semantic color.
- Floating sidebars, sticky top bars, phone tabs, dialogs and segmented controls share a 24px-radius glass material. Content, inputs, tables and forms remain opaque. No nested blur.
- Glass starts with a solid fallback and activates only inside `@supports`. Reduced transparency restores solid surfaces. The 92% warm-white fill intentionally exceeds the suggested opacity range so secondary text remains readable even over dark scrolled content.
- Quiet 150ms state transitions and a complete reduced-motion fallback. Disabled controls use opaque neutral surfaces and readable text, rather than reduced opacity.
- Removed violet, decorative icon tiles, display sparklines, glows, gradient styling, filler eyebrows and monospace presentation of ordinary identifiers. App and Home Screen icons use the existing editable mark in teal.

## Screen changes

| Screen | Result |
| --- | --- |
| Today | Attention appears before stock totals. Quiet totals and direct data labels replace decorative dashboard treatments. Shared stock and register Today use the same visual hierarchy. |
| Production | One Record action, readable production rows, aligned quantities and the existing register form flow. |
| Stock | Clear search and stage filters, quiet stock totals, large material/batch rows, explicit QC labels and accessible stage selection. Shared empty state gives the material → batch → receipt sequence without duplicate primary actions. |
| Orders | Readable order numbers and dates, restrained progress marks, one Record action, preserved review flow. |
| Dispatch | Same control and register vocabulary as Production; QC restrictions stay explicit. |
| Registers | Solid tables, normal-font identifiers, tabular quantities, readable dates and keyboard-focusable horizontal scroll regions. Mobile instructions reveal offscreen columns and actions. |
| More | Plain task rows with useful icons; no tinted card grid. |
| Reports | Neutral report list and previews, sentence-case headings, original export/print behavior. |
| Workspace, settings, masters and people | Consistent labeled controls, visible selections, clear ownership/access wording and readable team records. Shared storage wording distinguishes the Mac's database from hosted records. |
| Search, help, day close and saved status | Clear task descriptions, explicit recovery/confirmation states, quiet dividers and visible saved/connection status. |
| Scanner | Separate stock-label, fabric-inspection and yarn-spec tasks. Solid capture/results surfaces, plain instructions, meaningful status icons and readable disabled actions. No synthetic AI results were added. |
| Sign in and workspace setup | Task-first headings and a single next action; existing authentication and membership rules preserved. |
| Forms | Existing register defaults, validation, drafts, review and reversals retained. Real-workspace forms now show inline native validation and an explicit review summary before saving. Failed saves retain values. |
| Details and dialogs | Shared typography, opaque form content, readable metadata and modest surfaces beneath floating dialog chrome. |
| Undo | A saved real stock movement offers **Undo entry**, which opens the existing reversal flow with a visible reason and review. Server constraints and immutable original history still apply. |
| Urdu | Logical layout retained; Latin material/spec identifiers isolated so their order survives right-to-left rendering. |

The old register banner's real-workspace button now opens `/`; it previously displayed an obsolete message claiming the real app was unavailable.

## Evidence

- [Baseline findings and captures](BASELINE.md): route-by-route issues recorded before implementation.
- [Final QA summary](QA.md): 444 captures, zero automated failures; exact coverage and limits.
- [After screenshot audit](after/audit.json): machine-readable route/state, viewport, axe, typography, target, overflow, color and material checks.
- [Impeccable detector](design-detector.json): one required run; no findings.
- [Headless performance smoke](performance.json): Chromium with 4× CPU slowdown on the local register Today route. Observed LCP 252–272ms, CLS 0.0002–0.0193, scroll-frame p95 17.3–17.5ms and no sampled scroll frames above 50ms. These are local lab observations, not field p75 or physical-tablet GPU measurements.
- [Independent finish review](FINISH-REVIEW.md): findings and final disposition at its stated review scope.
- [Register implementation details](../GLASS-REGISTERS.md).

The capture harness uses an isolated in-memory QA database and synthetic stock records confined to that server. It does not seed or change the user's database. Screenshots run at 1440, 1024 and 390px, plus reduced transparency, dark mode and Urdu. Additional captures cover representative loading, connection-error, permission-denied, empty and confirmation states. The final audit is the source of truth for exact capture counts and results. The full matrix plus finite dialog coverage is indexed in after/audit.json; targeted recaptures replace affected rows instead of inflating the count. All 14 Chromium/WebKit workflow tests passed.

## Validation and limitations

The production build and all 38 unit/API tests passed. Browser tests cover the material → batch → receipt → QC → dispatch workflow, review/save/undo/reversal, cross-device membership, barcode-photo decoding, photo evidence, failed saves/offline behavior, accessibility and batch-history isolation in Chromium and iPhone WebKit. Final results are recorded alongside the finish review.

No feature was intentionally dropped. Stock arithmetic, permissions, storage, server validation, API schemas and model behavior are unchanged. The only interaction additions are UI validation/review and entry points to the existing reversal behavior.

Physical factory tablets, sustained Safari GPU scrolling, real camera operation and staff comprehension require device/user testing. No user interviews or usability results are claimed. The trained model service was not launched as part of this UI task; camera, inference and yarn measurement still require their existing environment and artifacts. Lighthouse and field Core Web Vitals were not measured. Existing hosted deployment was not changed.

The independent verdict is **ship for the seven listed review fixes**, all resolved. It is not a claim that an independent reviewer inspected every screenshot. The later prose-link targets, narrow-dialog Close label and readable lot/report dates were verified by the browser QA pass. Unreachable legacy branches (old workspace explanation, generic picker, date and notification dialogs, waste/cops form launchers) were retained in source and not forced into artificial screenshots.
