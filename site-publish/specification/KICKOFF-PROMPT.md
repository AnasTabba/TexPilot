# Kickoff prompts (paste into Codex or Claude Code)

## Prompt 1 — start (Phase 0)
```
You are building a production-grade, offline-first PWA that replaces the paper registers of a
yarn factory in Pakistan. Read AGENTS.md completely, then read every file in /docs in numeric
order, then look at everything in /design-templates.

Before writing any code:
1. Summarise back to me, in under 25 bullet points, what you understood: users, material flow,
   the non-negotiable rules, and the HCI principles you will enforce.
2. List any contradictions or gaps you found across the docs, and the default you propose
   for each. Write them to docs/OPEN-QUESTIONS.md.
3. If design templates exist, extract the design tokens (colours, type, spacing, radius) into
   a proposed tokens table, run WCAG AA contrast checks on every text/background pair, and show
   me any adjustments.
4. Write docs/progress/PHASE-0.md with your task list, file structure and risks.

Then wait for my "go". After "go", implement Phase 0 from docs/07-BUILD-PLAN.md exactly, including the
/dev/components gallery showing every component in every state in English and Urdu.
Commit in small steps. Finish by running all checks and reporting results plus screenshots.
```

## Prompt 2 — each next phase
```
Phase N-1 is accepted. Re-read AGENTS.md, docs/07-BUILD-PLAN.md (Phase N), the relevant parts of
docs/04-SCREENS.md and docs/05-EDGE-CASES.md. Write docs/progress/PHASE-N.md (tasks, files, risks,
edge-case IDs you will test), then implement. For every screen: build all states, both languages,
mobile + desktop, then run typecheck, lint, unit, e2e and axe checks. Save screenshots to
docs/progress/screens/. Report what was done, what is left and any decisions in docs/DECISIONS.md.
```

## Prompt 3 — design review pass (run after each phase)
```
Act as a senior HCI/UX reviewer. Go through every screen built in this phase at 360 px and
1440 px, in English and Urdu, light and Factory mode. Check against docs/02-UX-HCI-PRINCIPLES.md
point by point (Nielsen heuristics, Fitts, Hick, error prevention, recovery, feedback, RTL,
accessibility, performance). Produce docs/progress/REVIEW-PHASE-N.md with a table:
screen | issue | principle violated | severity (blocker/major/minor) | fix. Then fix all
blockers and majors and re-run the checks.
```

## Prompt 4 — edge-case audit
```
Go through docs/05-EDGE-CASES.md. For each ID in scope for the phases done so far, show the test
that covers it (file + test name) or write it if missing. Report a coverage table. Do not mark an
ID covered unless a test actually exercises the behaviour.
```

## Tips
- Keep one phase per session; start a new session with Prompt 2 when context gets long.
- Put your design templates in /design-templates before Prompt 1.
- Answer docs/OPEN-QUESTIONS.md before saying "go" — especially the yarn-spec questions.
