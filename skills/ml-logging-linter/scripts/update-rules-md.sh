#!/usr/bin/env bash
# Sync references/RULES.md from the eslint plugin source of truth.
# Usage:
#   ./update-rules-md.sh          # compare only (safe default)
#   ./update-rules-md.sh --update # copy source to overwrite local copy

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
SKILL_DIR="$(dirname "$SCRIPT_DIR")"
LOCAL="$SKILL_DIR/references/RULES.md"

SOURCE="$HOME/projects/infitx-org/linter-assesment-framework/eslint-plugin-mojaloop-logging/docs/RULES.md"

if [[ ! -f "$SOURCE" ]]; then
  echo "ERROR: Source not found: $SOURCE" >&2
  exit 1
fi

if [[ ! -f "$LOCAL" ]]; then
  echo "Local copy missing: $LOCAL"
  if [[ "${1:-}" == "--update" ]]; then
    cp "$SOURCE" "$LOCAL"
    echo "Created local copy from source."
    exit 0
  else
    echo "Run with --update to create it."
    exit 1
  fi
fi

if diff -q "$SOURCE" "$LOCAL" > /dev/null 2>&1; then
  echo "OK: references/RULES.md is up to date with the eslint plugin."
  exit 0
fi

echo "DIFF: references/RULES.md differs from the eslint plugin source."
echo ""
diff --color=auto "$SOURCE" "$LOCAL" || true

if [[ "${1:-}" == "--update" ]]; then
  cp "$SOURCE" "$LOCAL"
  echo ""
  echo "Updated: references/RULES.md overwritten from source."
else
  echo ""
  echo "Run with --update to overwrite the local copy."
fi
