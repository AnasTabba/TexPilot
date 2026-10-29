# Factory Portal integration wave — 2026-10-29 (feat/factory-portal LOCAL integration of Tasks 6–11; nothing deployed)

Owner: Task11 integration worker (Orca, terminal term_cc3b1d91-319b-4c5c-a057-45d0a2b342d3, task task_7b13a70ac13c).

## What landed (feat/factory-portal)

- `2164cdc` (fp/proc, Task 11) reviewed against the plan header, `docs/specs/factory-portal-spec.txt` + `factory-portal-decisions.md` and `DESIGN.md`, then ff-only merged over base `ed5d50a`. Stock invariant: every ledger write goes through `server/stock-ledger.mjs movementQueries`; role invariant: `role()`/`viewer()` guard every `/api/erp/stock/*` route with `interventionReason` for admins; approval invariant: `needsApproval` on the stored threshold payload, decided rows frozen by `0015` triggers, negative stock refused 409 and any whole-batch race rolled back.
- `809ebdf` — restored `scripts/gate.sh` (unit tests → `npx tsc -b` → `npm run build` → `npx playwright test --project=desktop-chromium` with `CI=1` on `YARNFLOW_TEST_PORT` default 8795). Exits non-zero on the first failing stage's real exit status; no output-text (grep) gating, fixing the 20:08 incident class. The build stage exists because the e2e dev server serves the built bundle: a stale `dist/` once made Playwright test old code.
- `e5de142` — Luna review finding fixed: dropped the `LIMIT 200` per-category cap in `server/stock.mjs draftOf` (the submitted snapshot/flags silently omitted in-period rows past 200). Added a no-cap regression in `tests/stock.test.mjs`: 210 confirmed rejections + 205 adjustments in the period are all listed, and items past the old cap can be flagged through the report POST.

## Gate evidence (real exit statuses)

| Stage | Result |
|---|---|
| `sh scripts/gate.sh` (overall) | exit 0, printed `GATE PASSED` |
| `npm test` | tests 299, pass 299, fail 0 (includes `tests/migrations.test.mjs`: `0015 applies before or after the later migrations and keeps every row` ✔, and 0017b/0016b view guards ✔) |
| `npx tsc -b` | exit 0, no output |
| `npm run build` | exit 0 (tsc + vite + offline + worker bundle; the e2e server serves this fresh bundle) |
| `npx playwright test --project=desktop-chromium` | 46 passed, 0 failed, `CI=1` fresh server on `YARNFLOW_TEST_PORT=8795` (reuseExistingServer off) |

Pre-fix diagnostic runs recorded: `npm test` on untouched integration HEAD → exit 0 (298/0); first gate run → exit 1 with the same 4 desktop e2e tests failing because the webServer reused a stale `dist/` bundle built 20:08 from pre-Task-11 code (served UI had "Reverse entry" buttons and no admin intervention fields; `grep` of `dist/assets/*.js` confirmed it). The gate then builds current source (`npm run build`) and forces a fresh `CI=1` server, and the reruns above passed all 46. Unit fail 0 throughout.

## Scope boundaries respected

- Only `scripts/gate.sh`, `server/stock.mjs`, `tests/stock.test.mjs` changed in my commits; no push, no deploy, no live DB writes, no helper/editor touches, no dirty FYP edits.
- Task 14 (`fp/proc` dispatch lifecycle) and Task 16 (`fp/sales`) remain owned by their agents; the temporary immediate-dispatch path is intentionally left open.

## Open items

- Luna's independent read-only Task 11 review may still add findings; the report-cap one is fixed here.
- After later tasks merge: rerun `scripts/gate.sh` before any controller gate/deploy; the dist rebuild step in the gate is what keeps e2e honest.
