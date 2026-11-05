# Liquid-glass screen build — 24 October 2026

## Scope and result

Delivered 18 navigable practice screens and the related entry, review, detail, lot timeline, order, report and reversal dialogs. The supplied kit remains intact under `specification/`; the kickoff's embedded stop-and-wait prompt was not treated as a user instruction. This screen build does not mark any complete production phase in the kit as accepted.

The app lives in its own project directory and source repository. Existing TexPilot changes were not edited.

## Verification

- Strict TypeScript check and Vite production build passed.
- Nine automated domain tests passed, including integer-gram parsing, negative stock prevention, QC hold, idempotency, reversal integrity, dependent stock reversal blocking, future dates, transfer conservation and a 100-entry/reversal invariant.
- Browser smoke test: new production entry → review → save → updated stock and production → reload → record retained → reversal with reason → exact original stock restored. The original and reversing entries both remain in history.
- PIN 1234 enters the practice workspace. Draft fields save per user and transaction type. Modal focus is trapped and restored, Escape closes dialogs, and scrollable registers are keyboard focusable.
- 35 axe WCAG A/AA screen audits completed with zero reported violations after fixes: all 18 routes at 360 px and 17 at 1440 px (search was audited at 360 px). Machine-readable final results are in `accessibility-audit.json`.
- Screenshots and visual review completed for desktop English login/overview and Urdu overview. A live narrow preview was reviewed and its alert wrapping was corrected. Urdu uses RTL layout and self-hosted Nastaliq with LTR-isolated numeric values.
- Package audit reported zero vulnerabilities. Initial JavaScript is approximately 106 KB gzip. Fonts are hosted with the app. The production build creates a hashed service-worker precache list covering the shell, scripts, styles and fonts.

Automated accessibility checks are not a complete manual WCAG certification. The production service worker was inspected and precache generation checked; a complete offline/reconnect and update-cycle browser suite has not been run. No production server concurrency, authentication, encrypted-storage, backup-restore or real-staff usability testing is claimed.

## Accessibility fixes from review

- Darkened secondary copy, active tabs, practice labels, semantic statuses and small avatar initials.
- Retained quiet surface colors while bringing audited text contrast above AA thresholds.
- Added focusable, labelled regions around horizontally scrolling tables.
- Corrected crowded phone alert layout and reduced oversized desktop login height.
- Preserved focus indicators, dialog focus recovery, reduced-motion preferences, RTL direction and isolated time ranges.

## Next production milestone

Agree the factory-specific answers in `../OPEN-QUESTIONS.md`, then implement and accept the kit's Phase 0 infrastructure: authenticated users/devices, PostgreSQL, role enforcement, encrypted IndexedDB outbox and authoritative sync. Follow the remaining phases and real-staff parallel-run gates before using real factory data.
