#!/usr/bin/env bash
# Starts a sweep (or an eval run) on Nebius through the deployed app. Needs the same JOB_CALLBACK_SECRET as the Worker.
# Usage: JOB_CALLBACK_SECRET=... scripts/sweep-now.sh [sweep|eval]
set -euo pipefail
MODE="${1:-sweep}"; APP="${APP_URL:-https://probity.pages.dev}"
BODY="{\"mode\":\"$MODE\"}"; PATH_="/api/sweep/start"; TS="$(date +%s)"
SIG="$(printf '%s' "$TS.POST.$PATH_.$BODY" | openssl dgst -sha256 -hmac "$JOB_CALLBACK_SECRET" -hex | sed 's/^.* //')"
curl -sS -X POST "$APP$PATH_" -H "x-probity-timestamp: $TS" -H "x-probity-signature: $SIG" -H "content-type: application/json" -d "$BODY"; echo
