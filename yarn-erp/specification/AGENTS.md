# AGENTS.md — Yarn Factory Management System ("Register → Digital")

This file is the entry point for any coding agent (Codex, Claude Code, or others).
Read it fully before writing code. Then read the docs in `/docs` in numeric order.

## 1. What we are building
A secure, offline-first, installable web app (PWA) that replaces the paper registers of a
yarn factory in Pakistan: yarn receipt, machine issue, cops → TFO work-in-progress, finished
production, customer orders, dispatch, stock, search, reports and an owner dashboard.

The users are factory supervisors and operators who have only ever used paper registers,
on low-cost Android phones, often in poor light, noise, dust, with weak internet and power
cuts. Managers/owners use phones and desktops.

**The single success metric:** a supervisor who has never used the app can record a
production entry correctly within 60 seconds on day one, and the factory can stop using
the paper register after a 2–4 week parallel run without anyone complaining.

## 2. Documents (source of truth, read in order)
| File | Contents |
|---|---|
| `docs/01-PRODUCT-SPEC.md` | Domain, roles, master data, transactions, calculations, reports |
| `docs/02-UX-HCI-PRINCIPLES.md` | Non-negotiable usability rules and how to apply them |
| `docs/03-DESIGN-SYSTEM.md` | Tokens, typography, components, states, RTL, accessibility |
| `docs/04-SCREENS.md` | Every screen: purpose, layout, fields, behaviour, states |
| `docs/05-EDGE-CASES.md` | Edge cases with required behaviour — each must have a test |
| `docs/06-ARCHITECTURE.md` | Stack, data model, offline sync, security, build-to-last rules |
| `docs/07-BUILD-PLAN.md` | Phases, tasks, acceptance criteria, definition of done |
| `design-templates/` | Visual templates supplied by the product owner (see §5) |

If documents conflict: `05-EDGE-CASES` > `02-UX-HCI` > `04-SCREENS` > `03-DESIGN-SYSTEM` >
`design-templates/` for behaviour; `design-templates/` > `03-DESIGN-SYSTEM` for pure visual style.
If something is genuinely unspecified, choose the simplest behaviour that respects
`02-UX-HCI-PRINCIPLES.md`, implement it, and record the decision in `docs/DECISIONS.md`.

## 3. Non-negotiable rules
1. **Ledger, not spreadsheet.** Stock movements are immutable inserts. Balances are always
   derived. Never store a balance that a human typed. Corrections = void + new entry.
2. **Nothing is hard-deleted.** Transactions are voided with a reason; master data is archived.
3. **Every write is idempotent** (client-generated UUID `client_id`). Retries never duplicate.
4. **Weights are stored as integer grams**, counts as integers. Never floats for quantities or money
   (money as integer paisa).
5. **Server is the authority** for validation, permissions and serial numbers, but the UI must
   work fully offline and explain clearly what is pending.
6. **i18n from line one.** No hard-coded user-facing strings. English + Urdu (RTL) are both
   first-class. Use logical CSS properties (`margin-inline-start`, not `margin-left`).
7. **Accessibility:** WCAG 2.2 AA minimum. Touch targets ≥ 48×48 px (primary actions ≥ 56 px).
8. **Every screen implements all states:** loading, empty, error, offline, partial data,
   permission-denied, success. No blank screens, no spinners without text after 1 s.
9. **TypeScript strict**, shared Zod schemas between client and server, no `any`.
10. **Tests are part of the feature.** Every edge case in `05-EDGE-CASES.md` gets a test.
11. Prefer boring, well-supported technology. No dependency without a clear reason.
12. Never put secrets in the repo. Never log PINs, tokens or personal phone numbers.

## 4. Working method for the agent
- Work **one phase at a time** from `docs/07-BUILD-PLAN.md`. Do not start a phase until the
  previous phase's acceptance criteria pass.
- At the start of each phase, write a short plan in `docs/progress/PHASE-N.md`
  (tasks, files, risks). Update it as you go.
- Small, reviewable commits with clear messages.
- After each feature: run typecheck, lint, unit tests, and the relevant Playwright tests
  at mobile (360×740) and desktop (1440×900) sizes, in both English and Urdu.
- Take screenshots of new screens in both languages and both sizes into
  `docs/progress/screens/` so the product owner can review.
- When unsure about a domain question (yarn/factory meaning), do not guess silently:
  add it to `docs/OPEN-QUESTIONS.md` and implement a configurable default.

## 5. Design templates
The product owner will place visual templates (images, Figma exports, HTML, or CSS) in
`design-templates/`. When templates are present:
1. Extract colours, type scale, spacing, radius and component shapes into the design tokens
   (`03-DESIGN-SYSTEM.md` §2 structure) — templates change *values*, not *structure*.
2. Check every extracted colour pair for WCAG AA contrast. If a template colour fails,
   keep the hue but adjust lightness, and note it in `docs/DECISIONS.md`.
3. Templates never override behaviour rules (touch target sizes, states, error handling,
   RTL, offline indicators). If a template omits a state, design it in the template's style.
4. Do not copy third-party brand assets or logos into the app unless the owner confirms
   they own them.

## 6. Commands (fill in once the project is scaffolded)
```
pnpm install
pnpm dev            # web app + api
pnpm typecheck
pnpm lint
pnpm test           # unit + integration
pnpm test:e2e       # Playwright, EN+UR, mobile+desktop
pnpm db:migrate
pnpm db:seed        # includes Practice Mode dummy data
```
