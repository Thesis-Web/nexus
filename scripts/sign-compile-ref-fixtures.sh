#!/usr/bin/env bash
# sign-compile-ref-fixtures.sh — Signs all compile-ref template fixtures
# except template-invalid-signature.json (intentionally left tampered).
#
# Run from repo root: bash scripts/sign-compile-ref-fixtures.sh

set -euo pipefail

FIXTURE_DIR="fixtures/compile-ref"
SIGN_SCRIPT="scripts/sign-template.ts"

for f in "$FIXTURE_DIR"/template-*.json; do
  base=$(basename "$f")
  if [ "$base" = "template-invalid-signature.json" ]; then
    echo "⊘ Skipping $base (intentionally invalid)"
    continue
  fi
  echo "→ Signing $base"
  pnpm exec tsx "$SIGN_SCRIPT" "$f"
done

echo ""
echo "✓ All compile-ref fixtures signed."
