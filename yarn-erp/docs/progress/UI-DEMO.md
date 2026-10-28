# Yarnflow redesign demo — 25 October 2026

Scope: an isolated desktop and mobile UI prototype at `/ui-demo/`. Visitor mode:
Operate. This is the reviewable demo the user requested before finalizing a new UI.
Production routes, backend, scanner integration, and existing design documents
remain outside this prototype's write boundary.

## Direction contract

THESIS: Translate the supplied Vault case study into a precise Yarnflow inventory
workspace, preserving stock traceability and honest inspection states. Use the
user's reference as the chosen direction; no alternative aesthetic selection is
needed before showing the requested demo.

OWN-WORLD: Charcoal olive navigation (#252720), near-white ground (#f5f6f2), white
work surfaces, and lime (#d0ed82) selection and actions. Manrope typography,
tabular quantities, compact Lucide icons, quiet dividers, and 12–13px panel radii.

STORY: See stock and QC attention, find a batch, inspect its history, and preview
a material check. Every quantity and result is clearly marked illustrative.

FIRST VIEWPORT: Desktop has a 216px dark sidebar, white breadcrumb bar, heading
and receipt action, four summary cards, and an inventory chart beside stock-stage
distribution. Phone has a compact branded header, two-column summary, stacked
work areas, and four fixed bottom destinations. Mobile inventory becomes a list
with quantity and QC status visible together.

FORM: Code-led, user-pinned warehouse dashboard reference. No concept roll or
image comp is authoritative; the linked reference was scrolled through and its
desktop/mobile app images inspected. The signature interaction is the framed,
interactive phone preview alongside the matching website view.

FINISH: Review at desktop and phone widths; check interactions, typecheck and
build; save captures and document this prototype; leave final rollout pending
the user's design approval.

## Verification

Browser checks cover desktop inventory search (including no matches), QC
filtering, batch details, dispatch disabled for a held batch, scanner loading and
insufficient-evidence results, and the mobile preview switch. Phone checks at
390 × 844 cover bottom navigation, no document overflow, mobile stock rows,
sample receipts updating totals, and the sample activity feed.

Typecheck: `npx tsc -p ui-demo/tsconfig.json`.
Build: `npx vite build --config ui-demo/vite.config.ts`.
Captures: `ui-demo/review/desktop.png`, `mobile.png`, `mobile-inventory.png`,
`scanner.png`, and `mobile-preview.png`.

No native binary, real camera session, trained-model inference, or production
deployment is part of this design preview.

## Final review

Independent visual review disposition: **ship**, scoped to the requested approval
demo. The single status-contrast finding was resolved and the desktop and phone
views recaptured. Badge contrast is 5.67–5.98:1; small positive annotations are
5.28:1. This is not approval to roll out the new production UI.
