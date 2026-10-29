#!/usr/bin/env bash
# Operator script: runs the NVIDIA NeMo Guardrails job on Nebius AI Cloud (serverless job, cpu-d3, 20 Gi disk) and reports back through
# the app's signed callback. The Worker cannot start jobs itself (Nebius's control plane answers Cloudflare 522 to Worker fetches).
# Usage: NEBIUS_API_KEY=... JOB_CALLBACK_SECRET=... scripts/start-sweep.sh [sweep|eval]
#   sweep: screens every open request's letter and e-mail text, checks stored rationales against their evidence.
#   eval : runs the labelled test letters (job/testset.json) and reports catch and false-alarm rates.
# The job name starts with probity-; delete the finished job with: nebius --profile hackathon-jobs-sa ai job delete --id <id>
set -euo pipefail
MODE="${1:-sweep}"; APP="${APP_URL:-https://probity.pages.dev}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; J="$ROOT/job"
: "${NEBIUS_API_KEY:?export NEBIUS_API_KEY (Token Factory key)}"; : "${JOB_CALLBACK_SECRET:?export JOB_CALLBACK_SECRET}"
SWEEP_ID="sweep-$(openssl rand -hex 4)"
FILES=(--inject-file "$J/run.sh:/opt/probity/run.sh" --inject-file "$J/sweep.py:/opt/probity/sweep.py" --inject-file "$J/config/config.yml:/opt/probity/config/config.yml" --inject-file "$J/config/prompts.yml:/opt/probity/config/prompts.yml")
[ "$MODE" = "eval" ] && FILES+=(--inject-file "$J/testset.json:/opt/probity/testset.json")
JOB_ID="$(nebius --profile hackathon-jobs-sa ai job create --name "probity-$MODE-$(date +%m%d-%H%M)" --image python:3.12-slim --platform cpu-d3 --preset 2vcpu-8gb \
  --disk-size 20Gi --timeout 1h "${FILES[@]}" --env "MODE=$MODE" --env "SWEEP_ID=$SWEEP_ID" --env "APP_URL=$APP" --env "NEBIUS_API_KEY=$NEBIUS_API_KEY" \
  --env "JOB_CALLBACK_SECRET=$JOB_CALLBACK_SECRET" --container-command bash --args /opt/probity/run.sh --async --format json | python3 -c "import json,sys;print(json.load(sys.stdin)['resource_id'])")"
echo "started $JOB_ID"
BODY="{\"sweepId\":\"$SWEEP_ID\",\"jobId\":\"$JOB_ID\",\"mode\":\"$MODE\"}"; TS="$(date +%s)"; P="/api/sweep/register"
SIG="$(printf '%s' "$TS.POST.$P.$BODY" | openssl dgst -sha256 -hmac "$JOB_CALLBACK_SECRET" -hex | sed 's/^.* //')"
curl -sS -X POST "$APP$P?pts=$TS&psig=$SIG" -H "content-type: application/json" -d "$BODY"; echo
echo "watch: nebius --profile hackathon-jobs-sa ai job get --id $JOB_ID --format json | python3 -c \"import json,sys;print(json.load(sys.stdin)['status']['state'])\""
