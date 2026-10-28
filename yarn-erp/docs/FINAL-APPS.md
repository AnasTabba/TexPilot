# Approved Yarnflow UI — web and native iOS

The user approved the charcoal/white/lime demo on 25 October 2026. The final
interfaces use Yarnflow's own stock and inspection workflows, with larger text.
UI/UX Pro Max supplied the accessibility and native guidance; the supplied images
and approved demo remain visual authority over generic search recommendations.

Web app: `yarn-erp/src/LiveApp.tsx`, `LoginPage.tsx`, `WorkspaceDashboard.tsx`,
`approved.css`. Start the API and Vite from `yarn-erp/`:

```sh
YARNFLOW_LOCAL_DEV=1 YARNFLOW_SQLITE_PATH=.local/review-ui.sqlite npm run api:dev
npm run dev -- --port 5174
```

Open http://localhost:5174/ and choose Open local workspace. This is explicitly
emulated development identity. Hosted sign-in continues through the existing
provider. Team invite destinations survive login. The old UI demo remains at
`/ui-demo/` as a visual reference.

The review server uses `.local/review-ui.sqlite`, separate from the existing
`.local/inventory.sqlite`. `YARNFLOW_REVIEW_SEED=1 node scripts/seed-review.mjs`
explicitly creates illustrative review stock; it refuses to populate a different
existing workspace. Production data is never automatically seeded.

The separate native SwiftUI source, simulator build instructions, and remaining
native release requirements are in `../../ios/README.md`.

Verification completed: TypeScript check; 44 Node tests including ledger, API,
scanner, and stock-summary checks; web page sweep across all 12 destinations;
no document overflow at the inspected desktop width; inspected visible main text
at least 14px, body text 16px; native simulator build and login; native connected
workspace totals match the web ledger. The new native UI uses semantic Dynamic
Type fonts, 44-point controls, and explicit review mode.

Remaining acceptance: native hosted authentication, physical iPhone camera,
VoiceOver, largest Dynamic Type, native landscape/tablet, and full browser E2E
suite updates for the new login/navigation. Existing stock API authorization and
validation tests remain green. A local review launch is not an App Store release.

The 75% session-usage stop condition applies to this implementation run only.
