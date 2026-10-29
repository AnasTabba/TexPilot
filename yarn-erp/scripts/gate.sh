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
YARNFLOW_TEST_PORT="${YARNFLOW_TEST_PORT:-8795}" stage 'app build (npx vite build for the e2e server)' npx vite build
YARNFLOW_TEST_PORT="${YARNFLOW_TEST_PORT:-8795}" stage 'desktop Playwright' npx playwright test --project=desktop-chromium
printf '\n=== GATE PASSED\n'
