#!/usr/bin/env bash
# Publish training/, services/ and pyproject.toml as the private Kaggle dataset
# anastabba/texpilot-fault-code. Run from anywhere; paths are relative to scanner/.
# Usage: training/fault/publish_code.sh [--dry-run]
set -euo pipefail

DATASET="anastabba/texpilot-fault-code"
KAGGLE="$HOME/.local/kaggle-cli/kaggle-anas"
MAX_BYTES=$((5 * 1024 * 1024))

DRY_RUN=0
case "${1:-}" in
  "") ;;
  --dry-run) DRY_RUN=1 ;;
  *) echo "usage: $0 [--dry-run]" >&2; exit 2 ;;
esac

SCANNER_DIR="$(cd "$(dirname "$0")/../.." && pwd)"
cd "$SCANNER_DIR"

STAGE="$(mktemp -d)"
CANDIDATES="$(mktemp)"
KEEP="$(mktemp)"
cleanup() {
  rm -f "$CANDIDATES" "$KEEP"
  if [ "$DRY_RUN" -eq 0 ]; then rm -rf "$STAGE"; fi
}
trap cleanup EXIT

# Candidates: training/ and services/ minus caches, .DS_Store and Kaggle result folders, plus pyproject.toml.
{
  find training services -type f ! -name '*.pyc' ! -name '.DS_Store' \
    ! -path '*/__pycache__/*' ! -path '*/kaggle/*/result*/*'
  echo pyproject.toml
} | sort -u > "$CANDIDATES"

# Drop files over 5 MB and print their names.
skipped=0
while IFS= read -r f; do
  size="$(stat -f%z "$f")"
  if [ "$size" -gt "$MAX_BYTES" ]; then
    echo "skipped (over 5 MB): $f ($size bytes)"
    skipped=$((skipped + 1))
  else
    printf '%s\n' "$f" >> "$KEEP"
  fi
done < "$CANDIDATES"
echo "skipped files over 5 MB: $skipped"

COPYFILE_DISABLE=1 tar -cf - -T "$KEEP" | tar -xf - -C "$STAGE"

cat > "$STAGE/dataset-metadata.json" <<EOF
{
  "id": "$DATASET",
  "title": "texpilot-fault-code",
  "licenses": [{"name": "other"}]
}
EOF

files="$(find "$STAGE" -type f | wc -l | tr -d ' ')"
bytes="$(find "$STAGE" -type f -exec stat -f%z {} + | awk '{s += $1} END {print s + 0}')"
echo "staged dir: $STAGE"
echo "file count: $files"
echo "total bytes: $bytes"

SHA="$(git rev-parse --short HEAD)"
if [ -n "$(git status --porcelain -- training services pyproject.toml)" ]; then
  SHA="$SHA-dirty"
fi

if [ "$DRY_RUN" -eq 1 ]; then
  echo "dry run: no Kaggle call. Would run 'datasets version -m \"$SHA\"' if status succeeds, else 'datasets create'."
  exit 0
fi

[ -x "$KAGGLE" ] || { echo "missing Kaggle CLI wrapper: $KAGGLE" >&2; exit 1; }
if "$KAGGLE" datasets status "$DATASET" >/dev/null 2>&1; then
  "$KAGGLE" datasets version -p "$STAGE" -m "$SHA" --dir-mode zip
else
  "$KAGGLE" datasets create -p "$STAGE" --dir-mode zip
fi
