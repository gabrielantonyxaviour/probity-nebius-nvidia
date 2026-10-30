#!/usr/bin/env bash
# Operator script: LoRA fine-tune of an NVIDIA Nemotron model for Probity's injection screen, in ONE Nebius AI Cloud Serverless GPU job
# (1x H100, eu-north1). The job writes its own training data with Nemotron 3.5 Lightning on Token Factory, checks it for overlap with the
# 39 held-out test letters, trains a LoRA adapter, and prints one line `FINETUNE_REPORT {json}` with the base vs tuned results.
# Usage: NEBIUS_API_KEY=... scripts/start-finetune.sh        then read the result with:
#   nebius --profile hackathon-jobs-sa ai job logs <id>        and delete the job with:  nebius --profile hackathon-jobs-sa ai job delete --id <id>
# Env overrides: BASE_MODEL, EPOCHS, N_INJ, N_PLAIN, N_HARD, PER_KIND, DRY_RUN=1 (validate only). No app callback: the report is read from the logs.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"; F="$ROOT/job/finetune"
: "${NEBIUS_API_KEY:?export NEBIUS_API_KEY (Token Factory key)}"
PROJECT="${NEBIUS_GPU_PROJECT:-project-e00fwfe5pr00k4s8jdngz0}"   # eu-north1: the H100 quota lives here (the default profile project is eu-west2, CPU only)
GZ="$(mktemp -t probity-testset).json.gz"; gzip -9c "$ROOT/job/testset.json" > "$GZ"   # the job payload is capped near 48 KB
FILES=(--inject-file "$F/run.sh:/opt/probity/finetune/run.sh" --inject-file "$F/gen_data.py:/opt/probity/finetune/gen_data.py" --inject-file "$F/dedupe.py:/opt/probity/finetune/dedupe.py"
  --inject-file "$F/train_eval.py:/opt/probity/finetune/train_eval.py" --inject-file "$GZ:/opt/probity/finetune/testset.json.gz")
ENVS=(--env "NEBIUS_API_KEY=$NEBIUS_API_KEY")
for v in BASE_MODEL EPOCHS N_INJ N_PLAIN N_HARD PER_KIND; do [ -n "${!v:-}" ] && ENVS+=(--env "$v=${!v}"); done
DRY=(--async); [ -n "${DRY_RUN:-}" ] && DRY=(--async --dry-run)
OUT="$(nebius --profile hackathon-jobs-sa ai job create --parent-id "$PROJECT" --name "probity-finetune-$(date +%m%d-%H%M)" --image pytorch/pytorch:2.5.1-cuda12.4-cudnn9-runtime \
  --platform gpu-h100-sxm --preset 1gpu-16vcpu-200gb --disk-size 100Gi --timeout 75m "${FILES[@]}" "${ENVS[@]}" \
  --container-command bash --args /opt/probity/finetune/run.sh "${DRY[@]}" --format json)"
[ -n "${DRY_RUN:-}" ] && { echo "dry run ok"; exit 0; }
JOB_ID="$(printf '%s' "$OUT" | python3 -c "import json,sys;print(json.load(sys.stdin)['resource_id'])")"
echo "started $JOB_ID"
echo "state: nebius --profile hackathon-jobs-sa ai job get --id $JOB_ID --format json | python3 -c \"import json,sys;print(json.load(sys.stdin)['status']['state'])\""
echo "logs:  nebius --profile hackathon-jobs-sa ai job logs $JOB_ID   (look for the line FINETUNE_REPORT)"
