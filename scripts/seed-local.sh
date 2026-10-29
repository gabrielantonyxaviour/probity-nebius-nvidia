#!/usr/bin/env bash
# Apply migrations + seed to the local D1 and upload fixture files to the local R2 (wrangler --local, no network).
# Env: WRANGLER_CONFIG (default engine/wrangler.jsonc), DB_NAME (default probity), BUCKET (default probity-files),
#      PERSIST_TO (default: wrangler's own default, engine/.wrangler/state; `wrangler dev` reads the same place).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CONFIG="${WRANGLER_CONFIG:-$ROOT/engine/wrangler.jsonc}"
DB_NAME="${DB_NAME:-probity}"
BUCKET="${BUCKET:-probity-files}"
PERSIST=()
[ -n "${PERSIST_TO:-}" ] && PERSIST=(--persist-to "$PERSIST_TO")
W=(wrangler)
command -v wrangler >/dev/null || W=(npx --yes wrangler)

cd "$ROOT/engine"
for f in migrations/*.sql; do
  echo "migrate $f"
  "${W[@]}" d1 execute "$DB_NAME" --local -c "$CONFIG" "${PERSIST[@]}" --file "$f" >/dev/null
done
[ -f seed/seed.sql ] || node "$ROOT/scripts/make-seed.ts"
echo "seed seed/seed.sql"
"${W[@]}" d1 execute "$DB_NAME" --local -c "$CONFIG" "${PERSIST[@]}" --file seed/seed.sql >/dev/null

for dir in "$ROOT"/fixtures/requests/*/; do
  id="$(basename "$dir")"
  echo "r2 $id"
  "${W[@]}" r2 object put "$BUCKET/$id.letter.pdf" --local -c "$CONFIG" "${PERSIST[@]}" --file "$dir/letter.pdf" --content-type application/pdf >/dev/null
  if [ -f "$dir/headers.eml" ]; then
    "${W[@]}" r2 object put "$BUCKET/$id.headers.eml" --local -c "$CONFIG" "${PERSIST[@]}" --file "$dir/headers.eml" --content-type message/rfc822 >/dev/null
  fi
done
echo "local D1 and R2 seeded"
