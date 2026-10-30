#!/usr/bin/env bash
# Entrypoint of the Probity fine-tune job on Nebius AI Cloud (1x H100, pytorch/pytorch CUDA image). Files are injected under /opt/probity/finetune.
set -euo pipefail
export HF_HOME=/tmp/hf PYTHONUNBUFFERED=1 TOKENIZERS_PARALLELISM=false
pip install --no-cache-dir -q "transformers==4.51.3" "peft==0.15.2" "accelerate==1.6.0" "huggingface_hub<1.0"
nvidia-smi --query-gpu=name,memory.total --format=csv,noheader || true
exec python3 -u /opt/probity/finetune/train_eval.py
