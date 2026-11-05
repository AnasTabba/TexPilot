# Yarnflow UI redesign — 24 October 2026

The Overview screenshot was treated as the design to replace. The implementation keeps the existing ledger, Urdu support, local persistence, and TexPilot connection contract.

## Changes

- Today starts with explicit QC holds and due orders, each with a named action. Totals are rounded to whole kilograms. Machine production is sorted, with values and a 500 kg target marker. The seven-day bar chart starts at zero and uses actual saved entries; unrecorded days show zero, with an explanation and a data table.
- Shared layouts use neutral surfaces, one blue action/selection accent, readable text, visible focus, labelled icons, and large controls. Removed greetings, slogans, gradients, glows, ornamental charts and uppercase eyebrows. Status colors include words and icons. Reduced-motion preferences disable animation.
- Desktop navigation contains seven items. Small screens use five bottom tabs; More exposes less frequent tasks. The scanner has one navigation entry point. Local save/offline status stays in a fixed place. Backup details remain under Settings → Data.
- Practice mode is persistent and explicit. “Switch to real workspace” explains the existing missing factory connection. This UI does not fabricate a live workspace or queued uploads.
- Stock movement forms have three steps, button choices, empty quantity defaults, current date/shift and last-used machine, inline validation, stock-limit checks, a register-line review, saved confirmation, another-entry and Done actions, and reversible entries. Per-user drafts survive dismissal and reload. Orders have a persistent draft and a review step.
- Local storage writes happen synchronously before stock commits. Failure preserves the draft on the page and exposes a retry action. Normal users no longer navigate to a sync screen to check save status.
- All screen copy is centralized in `src/ui-copy.ts`. English and Urdu continue to use the existing translator, document language, and RTL layout. Factory names, specifications and model data remain data.

## Verification

- `npm test`: 17 ledger and scanner-contract tests passed.
- `npm run build`: TypeScript, Vite production bundle, and offline-shell preparation passed.
- `.qa/redesign-check.mjs`: 20 routes × four environments = 80 audits. Environments: 1440 px English/light, 390 px English/light, 390 px Urdu/light, and 1440 px English/dark. No detected WCAG 2.2 AA axe violations, text below 14 px in the checked main content, page overflow, or JavaScript page errors. Scrollable tables stay contained.
- `.qa/redesign-workflow.mjs`: exercises negative quantities, draft restoration after reload, offline save, exact save feedback, undo, QC holds, excessive dispatch quantities, order review/save, login navigation, practice-workspace explanation, storage failure, and a 720 px desktop-equivalent viewport for 200% zoom. Quantity, review, and order-review dialogs also receive axe checks.

Raw results are in `redesign/audit.json` and `redesign/workflows.json`, alongside desktop, phone and Urdu screenshots. The scripts use an isolated browser context and do not change the user's browser data.

Automated checks are evidence for the tested combinations, not a claim of complete WCAG conformance. Training sessions with mill staff, physical device and screen-reader testing remain valuable. Factory authentication, stock synchronization, permissions, and real order/dispatch linking still need the backend described in the existing project docs. Live camera hardware and model predictions were not validated by these UI checks.
