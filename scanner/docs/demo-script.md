# Demo script: scan, unsure, correct, review, retrain

Status: SKELETON, 31 Oct 2026. Click targets marked PENDING are filled after the flow is run
locally against Agent 2's UI. Before-and-after numbers come only from Agent 3's saved results.

## Goal of the demo (60-90 seconds on stage)

1. Scan one garment. The scanner answers with a fabric class and a confidence.
2. Scan a second garment that the scanner marks "Unsure" (below tau 0.665).
3. Correct it in the UI with the right class.
4. The correction appears in the review queue.
5. Approve it.
6. Show the before/after numbers from the retraining round (macro F1 first, then accuracy).

Say plainly: the retraining numbers come from simulated corrections on archive photos, not from
live operators. See `docs/human-in-the-loop-writeup.md`, section 5.

## Prep checklist (run the day before and again 30 minutes before)

- [ ] Scanner API up on the laptop: `curl -s localhost:8000/api/v1/model` returns `ready: true`.
      Restart command is in `NEXT_SESSION.md`. Do not restart during the demo.
- [ ] Served head includes the abstention output: `ScanResult.structure_answer` present in a test
      scan (added by Agent 1; needs a scanner restart to appear).
- [ ] Yarnflow UI running locally from Agent 2's worktree (not the live site). Dev command: PENDING.
- [ ] Two demo photos chosen in advance: one that scans confidently, one that comes back Unsure.
      Keep the file names on a card, not in the speaker's head. PENDING: file names after rehearsal.
- [ ] Review queue empty at the start. Demo data is local only; the live ledger is not touched.
- [ ] Before/after numbers printed from `docs/figures/learning_curve.pdf` and
      `docs/figures/per_class_f1.pdf`, or MISSING if Agent 3 did not land.
- [ ] Laptop on power, notifications off, display mirroring tested, browser zoom at 125%.
- [ ] Phone hotspot or second network available.

## Verified locally, 31 Oct 2026 (Agent 2 worktree, commit 4136ca9)

Ran `npx vite build`, `node scripts/prepare-offline.mjs`, then
`YARNFLOW_TEST_PORT=8891 npx playwright test e2e/scan-corrections.spec.ts` inside
`.claude/worktrees/agent-ac937a3f90ba4aff4/yarnflow`. Result: 2 passed (desktop-chromium, iphone-webkit).
Local in-memory test server only; the live site and live ledger were not used. Log:
`/private/tmp/claude-501/-Users-anastabba-Documents-iba-sem7-FYP/60b535d1-7e2f-4caa-ad4e-ac9963290cc6/scratchpad/e2e-corrections.log`.

Flow the test walks: sign in as Anas, open `#/scanner`, upload a photo, click "Analyze material",
see the `.scan-correction` panel with heading "Unsure" and "Best guess", choose a fabric in the
"Fabric" select, click "Save correction" (status "Correction sent for review"), then approve as a
supervisor in "Scan review".

**Breakage found (must fix or narrow the demo):**

1. The e2e stub returns an old-schema scan (`scanner-v6`, `fibre_family` head at 41%, fibre candidates).
   It never returns the v8 fabric answer, so the test does not cover the fabric "Unsure" path.
2. The UI does not read `structure_answer` (`yarnflow/src/scanner-client.ts` has no reference). Agent 1
   added it to `services/api/schemas.py`. Result: a v8 fabric abstention will not show the "Unsure" panel.
   The panel fires only when `unknown === true` (no such top-level field in `ScanResult`) or the fibre
   answer's probability is below 0.6.
3. Threshold mismatch: UI `UNSURE_BELOW = 0.6`; Agent 1's served fabric tau is 0.6697 (val target 0.90).
4. Taxonomy mismatch: correction picker uses the 33 fibre classes; Agent 1's abstention is over the
   24 fabric classes. A correction saved in the UI cannot be used as a fabric-head training label without a
   mapping. Agent 3's rounds must state which label space they used.
5. Sign-in and the scan path use the old `fibre_family`/`custom` fields; the v8 scanner is not running on
   localhost:8000 at the time of the check (curl connection refused), so no live scan was run.

Demo decision needed before rehearsal: either (a) Agent 2's UI reads `structure_answer` and uses tau 0.6697 with
the 24 fabric classes, or (b) the demo shows the abstention on the scanner JSON and the UI flow with the fibre
Unsure panel, stated honestly as a different head. Option (a) is not done here (rule: do not edit others' source).

## Click-by-click flow

PENDING. Steps to be filled after the local run against the v8 scanner:

1. Open the scan screen. PENDING: route and button label.
2. Take or choose the confident photo. Result shows a class and confidence. PENDING: where the
   class and confidence are displayed.
3. Choose the Unsure photo. Result shows "Unsure" with candidate classes. PENDING: label text.
4. Click the candidate or "none fits". Choose the correct class. PENDING: control names.
5. Submit. Confirmation text. PENDING: exact text.
6. Open the review queue. The new correction appears with status pending. PENDING: queue location.
7. Approve as a second reviewer. PENDING: approval control and who approves.
8. Show the result: before and after figures. Numbers from Agent 3 only; MISSING if absent.

## Fallback plan

- Network or scanner down: use the saved screenshots from the rehearsal run (PENDING: folder path)
  and the saved scan JSON for the two demo photos. Say the scanner is offline; do not fake a live scan.
- UI breaks mid-flow: skip to the review queue and show the figures from `docs/figures/`.
- Retraining numbers MISSING: present the risk-coverage figure only and state the rest is pending.
- Never type demo entries into the live Cloudflare ledger during the demo.

## Timing

PENDING. Target: scan 15 s, unsure 15 s, correction 20 s, queue and approve 15 s, figures 20 s.
Total about 85 s, plus 2 minutes of questions.

## Rehearsal log

PENDING. Each run: date, step that broke, fix applied or reported.
