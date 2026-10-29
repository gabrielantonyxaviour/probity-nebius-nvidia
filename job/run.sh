#!/usr/bin/env bash
# Entrypoint of the Probity sweep job on Nebius AI Cloud (python:3.12-slim). Files are injected under /opt/probity.
set -euo pipefail
pip install --no-cache-dir -q nemoguardrails==0.24.1
exec python3 /opt/probity/sweep.py
