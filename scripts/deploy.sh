#!/usr/bin/env bash
# Deploys Probity to Cloudflare. NOT run by agents: the coordinator runs it after reviewing.
# Order: resources -> wrangler.jsonc ids -> migrations + seed (remote) -> R2 fixtures -> secrets -> engine -> web -> Pages front.
# Prereqs: `wrangler login` as the intended account, ~/.nebius/hackathon-jobs-sa.json, secrets in env or the vault (never printed).
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENGINE="$ROOT/engine"
W=(npx --yes wrangler)
DB_NAME="${DB_NAME:-probity}"; KV_NAME="${KV_NAME:-probity-cache}"; BUCKET="${BUCKET:-probity-files}"
CRED_FILE="${NEBIUS_SA_FILE:-$HOME/.nebius/hackathon-jobs-sa.json}"

echo "== 1. resources (created only if missing)"
cd "$ENGINE"
"${W[@]}" d1 list --json | grep -q "\"name\": \"$DB_NAME\"" || "${W[@]}" d1 create "$DB_NAME"
"${W[@]}" kv namespace list | grep -q "\"title\": \"$KV_NAME\"" || "${W[@]}" kv namespace create "$KV_NAME"
"${W[@]}" r2 bucket list | grep -q "^name: *$BUCKET\$" || "${W[@]}" r2 bucket create "$BUCKET"
echo "-- ids to put in engine/wrangler.jsonc (d1_databases[0].database_id, kv_namespaces[0].id):"
"${W[@]}" d1 list --json | python3 -c "import json,sys;[print('   D1 ', d['name'], d['uuid']) for d in json.load(sys.stdin) if d['name']=='$DB_NAME']"
"${W[@]}" kv namespace list | python3 -c "import json,sys;[print('   KV ', n['title'], n['id']) for n in json.load(sys.stdin) if n['title']=='$KV_NAME']"
[ "${SKIP_ID_CHECK:-0}" = "1" ] || { read -r -p "wrangler.jsonc has these ids? [y/N] " ok; [ "$ok" = "y" ]; }

echo "== 2. migrations and seed (remote D1)"
for f in migrations/*.sql; do "${W[@]}" d1 execute "$DB_NAME" --remote --file "$f" -y; done
node "$ROOT/scripts/make-seed.ts"
"${W[@]}" d1 execute "$DB_NAME" --remote --file seed/seed.sql -y

echo "== 3. fixtures to R2"
for dir in "$ROOT"/fixtures/requests/*/; do
  id="$(basename "$dir")"
  "${W[@]}" r2 object put "$BUCKET/$id.letter.pdf" --remote --file "$dir/letter.pdf" --content-type application/pdf >/dev/null
  [ -f "$dir/headers.eml" ] && "${W[@]}" r2 object put "$BUCKET/$id.headers.eml" --remote --file "$dir/headers.eml" --content-type message/rfc822 >/dev/null
  echo "   $id"
done

echo "== 4. secrets (values come from files or stdin, never from arguments)"
"${W[@]}" secret put NEBIUS_SA_CREDENTIALS < "$CRED_FILE"
for name in NEBIUS_API_KEY TAVILY_API_KEY; do
  [ -n "${!name:-}" ] || { echo "export $name first (for example via ~/.claude/vault/inject.sh)"; exit 1; }
  printf '%s' "${!name}" | "${W[@]}" secret put "$name"
done
openssl rand -hex 32 | tr -d '\n' | "${W[@]}" secret put JOB_CALLBACK_SECRET  # a new secret rotates the job HMAC key
echo "   SEC_USER_AGENT and APP_URL are vars in wrangler.jsonc (workers_dev false, only probity.pages.dev is public)"

echo "== 5. engine Worker (probity-engine)"
"${W[@]}" deploy

echo "== 6. web Worker (probity-web, OpenNext)"
cd "$ROOT/web"
npm run deploy

echo "== 7. Pages front (probity.pages.dev)"
cd "$ROOT/pages"
"${W[@]}" pages project list 2>/dev/null | grep -q "probity " || "${W[@]}" pages project create probity --production-branch main
"${W[@]}" pages deploy public --project-name probity --commit-dirty=true
echo "done: https://probity.pages.dev"
