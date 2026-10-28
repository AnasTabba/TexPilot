# Yarnflow design direction

## Authority and intended use

The user's 25 October 2026 brief is the source of truth. This is an operating tool for mill staff moving from paper registers, used on shared desktops and factory tablets/phones. Calm means readable, predictable and recoverable. Keep the shared database workspace as the default; retain the separate register interface and all its features without misrepresenting its data as shared stock.

The brief is complete enough to implement without an additional approval round. Keep the existing React/Vite application, routes, permissions, stock arithmetic and storage. No new marketing surfaces, paywalls, emails, decorative assets or production sample records.

## Skill inventory and concrete application

The directly applicable design-related SKILL.md files were read before implementation. The broader scaffolding and image-generation skills were also checked during verification; they add no new deliverables here. Some specialize in deliverables absent here; their useful principles are applied without adding those deliverables.

| Skill | Rules applied |
| --- | --- |
| impeccable | Operate mode; shared patterns; inspect real rendered states; keyboard focus; empty/error/loading states; remove template decoration; independent finish review. |
| epic-design | Bound expensive effects, respect reduced motion and coarse pointers; inspect existing assets. No new images are needed. Apply depth only to content beneath floating chrome. |
| ui-ux-pro-max | Accessibility and touch before aesthetics; five or fewer phone destinations; visible labels; responsive layout; one recognizable icon family. Local design-system search used as a cross-check, not as authority over the brief. |
| ui-design-system | Semantic CSS tokens, fixed type and spacing scales, component states, explicit responsive breakpoints and documented handoff. |
| senior-frontend | Preserve the React/Vite SPA; semantic reusable controls; self-host fonts; limit initial work and avoid unnecessary libraries. |
| ux-researcher-designer | Review tasks by severity: blocked work first, then hesitation and cosmetic issues. Staff description comes from the user; no invented interviews, personas, conversion rates or validation claims. |
| web-design-guidelines | Fresh Vercel guidelines: accessible names, labels, visible focus, no obscured focus, tabular figures, reduced motion, safe areas, long-content handling. |
| dataviz | Remove chart decoration; zero-based bar axes, flat teal marks, visible units/direct values, light gridlines and stable color meanings. |
| canvas-design | Alignment, negative space, restrained color and visual hierarchy. Its art-only output and tiny typography do not apply to this app. |
| poster-design | Reading order, precise alignment and sufficient safe margins. No poster, decorative texture or promotional typography is introduced. |
| landing-page-generator | One obvious verb-led primary action, mobile visibility, reserve asset dimensions. No hero, testimonial, pricing or marketing content is added. |
| form-cro | Keep necessary register fields, labels and entered values; inline recovery, sensible keyboard modes, review before saving. No arbitrary field removal from business records. |
| page-cro | Five-second task clarity, plain customer wording, clear action hierarchy. No acquisition funnels or unverified conversion claims. |
| popup-cro | Only user-triggered task overlays; accessible dismissal, readable mobile size, no overlapping interruptions. No exit-intent or promotional popups. |
| signup-flow-cro | Minimal workspace create/join setup and specific action labels; existing authentication remains unchanged. |
| onboarding-cro | Empty states explain the next real action: material, batch, receipt. No artificial sample stock, tours or celebration graphics. |
| paywall-upgrade-cro | Preserve a clear escape from interruptions and respect dismissal. There is no paywall to redesign or add. |
| email-template-builder | Consistent shared layout, readable type and localized copy principles. No email system exists in this scope; no provider or tracking is added. |
| visualize:visualize | Build changes in the actual application; do not substitute an in-conversation mockup for working product UI. |
| web-perf | Measure observed behavior, distinguish lab from field performance; keep glass bounded, avoid perpetual animation and unnecessary dependencies. |
| full-page-screenshot | Capture complete, settled routes and inspect dimensions; use existing Playwright QA for reproducible viewport captures instead of requiring remote debugging of a personal browser. |
| sites:sites | Local-only work in the already selected checkout and preview; no new hosted Site or deployment inferred from this local branch task. |
| saas-scaffolder | Checked its responsive shell and end-to-end route validation principles. Existing app is retained; no scaffolding, billing or auth changes. |
| senior-fullstack | Existing internal-tool React/Vite architecture is retained; UI changes preserve API and database boundaries. No architecture decision or infrastructure work is in scope. |
| imagegen | Existing vector identity and code-native controls remain editable; no generated bitmap mockups or decorative images. Teal Home Screen icons are rendered from the existing SVG. |
| pw | Isolated automated browser QA, semantic locators, real app/API, no arbitrary sleeps, captured screenshots and accessibility assertions. |

There are six installed CRO skills in this inventory; the initial progress message counted seven in error.

## Decisions where guidance differs

- The user's warm cotton and deep teal palette replaces all violet and blue defaults, including dark mode. Brand color is reserved for actions, selection, links, focus and data.
- The user's IBM Plex Sans and 14/16/18/20/24/32/40 scale replace skill defaults recommending Inter, tiny chart text, display faces or fluid headings. Weights are 400, 500, 600 only. All numbers use tabular figures.
- The user's 48px targets and 18px controls override skill examples of smaller buttons. Body text is 16px; supporting text never below 14px.
- Liquid Glass is explicitly requested for floating chrome only. It overrides generic anti-glass guidance, while content, forms, inputs, tables and charts remain solid. Use a 24px blur with 170% saturation behind high-opacity warm white; raise opacity for worst-case contrast. Solid fallback is the default outside `@supports` and under reduced transparency. Never nest glass.
- Motion is a quiet 150ms state transition; no parallax, cinematic text entrances, bouncing or animated decorative charts. Glass selection may transition up to 225ms. Reduced motion removes it.
- Content surfaces use a 10px radius and a light border, without the stronger shadow suggested by some skills. Floating chrome uses a soft neutral shadow and a 24px radius. Capsules are limited to controls in glass.
- No approval/comp exploration is required: the explicit brief asks to write this document and continue. Its constraints override new-work exploration gates. Changes remain reviewable in this branch.
- Preserve existing workflows rather than scaffold a new stack or publish automatically. The request follows local branch launch work and names no hosted destination.

## System

Palette: page #F7F6F3, content #FFFFFF, subtle #F1EFEA, line #E4E1DA, text #1B1D1F, secondary #5A5E63, teal #0F5F6B / hover #0B4C56 / tint #E6F0F1, success #1F7A45 on #E8F4EC, warning #9A5600 on #FFF3DF, danger #B42B24 on #FDEBEA. Inputs need a stronger neutral border for recognition. Shared tokens include dark theme equivalents.

Spacing: 4/8/12/16/24/32/40/48/64px. Content stays aligned to a common grid. Separate sections through space, with restrained borders for rows. One primary action per task state; empty states avoid duplicate primary buttons. Status always pairs words with a meaningful icon and its semantic color.

Glass scope: desktop sidebars, sticky top bars, phone tab bars, task dialogs/sheets/popovers, segmented switches and floating Record controls. Inner forms remain opaque. A form placed in a glass dialog receives a solid content surface so input/text readability does not depend on the backdrop.

## Verification and evidence

Before implementation: capture the existing shared and register routes, documenting defects per screen. After implementation: capture routes plus forms/details/dialogs at 1440, 1024 and 390px, plus reduced transparency, dark mode and Urdu/RTL checks. Use isolated QA stock fixtures only, never alter the user's real database. Audit contrast, focus, targets, text scale, overflow, console failures and reduced settings; inspect screenshots visually and fix failures.

Assumptions for performance: authenticated Vite SPA; shared office desktops and modest factory tablets/phones, intermittent network. Targets (not claimed field measurements): p75 LCP 2500ms, INP 200ms, CLS 0.1; initial JS budget 200KB gzip plus 80KB per lazy route; Lighthouse accessibility 95 and performance 85. Codex owns verification of this change; deployment owner should confirm device and field performance. Lab checks cannot certify factory staff usability or physical Safari scroll performance.

Sources consulted: [Apple materials](https://developer.apple.com/design/human-interface-guidelines/materials), [Vercel Web Interface Guidelines](https://github.com/vercel-labs/web-interface-guidelines/blob/main/command.md), [Core Web Vitals](https://web.dev/articles/vitals). These inform implementation and testing; the user's explicit constraints govern styling.
