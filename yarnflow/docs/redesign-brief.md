# Yarnflow redesign brief (branch feat/redesign)
Goal: complete UI + UX redesign, not a recolour. Web app in yarn-erp/src. Keep ScannerArtwork/FabricHero fabric art. Laptop/projector first, phone second. All real data stays; no hardcoded fake output.
## Palettes (tokens already set in src/yarnflow.css, use ONLY tokens, no new hex)
- Light = Sky Blue #0593C6 / White #FCFFFF / Hot Pink #D83995. Tokens: --brand, --brand-ink, --pop (CTA pink), --sheet, --ground, --rail (deep sky rail).
- Dark = Midnight #02070A / Electric Blue #0297DE / Cantaloupe #FC734D. Same token names; --pop is orange.
- Pink/orange (--pop) = ONE primary action per screen + live/attention. Blue (--brand) = navigation, selection, links, data. Never both pop fills on one screen section.
## Look
Atmospheric: soft blurred gradient glow behind hero/sign-in/dashboard header (blue to pop, low opacity, CSS gradients only), glass rail/nav (backdrop-filter, with solid fallback), big confident headline type (Figtree, tight tracking), generous space, rounded squircle edges (existing --r-*). Not boxy card grids, not crowded, not playful clip-art. WCAG AA contrast both themes.
## UX
Every screen: one clear title, one primary action (--pop), a named next step. Fewer clicks: collapse duplicate screens, group nav by job (Today, Stock, Sales, People). Empty/loading/error states designed. Keyboard + touch targets 44px.
## Motion (Emil Kowalski skill, .agents/skills/emil-design-eng)
Only transform/opacity, ease-out custom curves (--ease-out), 150-250ms, press scale .97, no animation on keyboard/high-frequency actions, honour prefers-reduced-motion, stagger entrances max 40ms.
## Rules
Edit ONLY your owned files. Do not rename classNames used by e2e tests (grep yarn-erp/e2e first). Do not touch server/, drizzle/. Run `cd yarn-erp && npx tsc --noEmit` before finishing; report changed files + 3-line summary.
