#!/bin/sh
# Merge gate for the factory portal: unit tests, typecheck, desktop Playwright.
# Exits non-zero with the failing stage's status; statuses are never read from output text.
set -u
cd "$(dirname "$0")/.." || exit 1
stage() {
  label=$1
  shift
  printf '\n=== %s\n' "$label"
  "$@"
  status=$?
  if [ "$status" -ne 0 ]; then
    printf 'GATE FAILED: %s (exit %d)\n' "$label" "$status"
    exit "$status"
  fi
}
stage 'unit tests (npm test)' npm test
stage 'typecheck (npx tsc -b)' npx tsc -b
# The e2e dev server serves the built bundle: a stale dist would test old code, so build through the full npm build (tsc + vite + offline + worker).
stage 'app build (npm run build for the e2e server)' npm run build
CI=1 YARNFLOW_TEST_PORT="${YARNFLOW_TEST_PORT:-8795}" stage 'desktop Playwright on a fresh server' npx playwright test --project=desktop-chromium
printf '\n=== GATE PASSED\n'
