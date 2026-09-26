#!/bin/sh
# Regenerate src/api/schema.gen.ts from the FastAPI app's OpenAPI schema.
#
# services/api/schemas.py is the source of truth for the wire contract. Never
# edit schema.gen.ts by hand -- change the Python schema (in a PR all three
# workstreams review), then run `npm run gen:api` and commit both.
#
# openapi-typescript is run through a pinned npx rather than installed: it
# peer-depends on TypeScript 5 and the app is on TypeScript 6.
set -eu
cd "$(dirname "$0")/.."

PYTHON="${PYTHON:-../.venv/bin/python}"
if [ ! -x "$PYTHON" ] && ! command -v "$PYTHON" >/dev/null 2>&1; then
  echo "No Python at $PYTHON. Run 'make setup' from the repo root, or set PYTHON=..." >&2
  exit 1
fi

# Portable across BSD (macOS) and GNU (CI) mktemp: explicit XXXXXX template.
WORK_DIR="$(mktemp -d "${TMPDIR:-/tmp}/texpilot-openapi.XXXXXX")"
trap 'rm -rf "$WORK_DIR"' EXIT
SCHEMA="$WORK_DIR/openapi.json"

"$PYTHON" ../scripts/export_openapi.py "$SCHEMA"
npx --yes openapi-typescript@7.13.0 "$SCHEMA" -o src/api/schema.gen.ts
