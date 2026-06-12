#!/usr/bin/env bash
# Apply all D1 migrations in order.
#
# Usage:
#   ./scripts/migrate.sh              # remote (production) database
#   ./scripts/migrate.sh --local      # local dev database
#
# All migrations are idempotent (CREATE/ALTER IF NOT EXISTS) — safe to re-run.
# New migrations are picked up automatically by filename sort order.

set -euo pipefail

FLAG="${1:-}"
if [[ "$FLAG" == "--local" ]]; then
  TARGET_FLAG="--local"
  TARGET_LABEL="local"
else
  TARGET_FLAG="--remote"
  TARGET_LABEL="remote"
fi

MIGRATIONS_DIR="$(dirname "$0")/../migrations"
FILES=( $(ls "$MIGRATIONS_DIR"/*.sql | sort) )

if [[ ${#FILES[@]} -eq 0 ]]; then
  echo "No migration files found in $MIGRATIONS_DIR"
  exit 1
fi

echo "Applying ${#FILES[@]} migration(s) to $TARGET_LABEL database..."

for f in "${FILES[@]}"; do
  echo "  → $(basename "$f")"
  npx wrangler d1 execute whisper "$TARGET_FLAG" --file="$f"
done

echo "Done."
