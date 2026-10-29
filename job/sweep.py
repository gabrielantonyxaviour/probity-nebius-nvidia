"""Probity pre-run sweep. Runs as a Nebius AI Cloud Serverless Job with NVIDIA NeMo Guardrails used as a library.

MODE=sweep : fetch open requests from the app, screen their untrusted text with the input rail, check each stored
             rationale against its evidence with the output rail, post a SweepReport.
MODE=eval  : run the labelled test letters (testset.json) through the input rail and report catch and false-alarm rates.
Env: NEBIUS_API_KEY (Token Factory key; from the environment or a SecretStash secret), APP_URL, JOB_CALLBACK_SECRET, SWEEP_ID.
Without APP_URL the report is only printed (CLI tests).
"""
import asyncio
import hashlib
import hmac
import json
import os
import sys
import time
import urllib.request
from datetime import datetime, timezone

from nemoguardrails import LLMRails, RailsConfig
from nemoguardrails.rails.llm.options import RailStatus, RailType

HERE = os.path.dirname(os.path.abspath(__file__))
MODE = os.environ.get("MODE", "sweep")
APP_URL = os.environ.get("APP_URL", "").rstrip("/")
SECRET = os.environ.get("JOB_CALLBACK_SECRET", "")
SWEEP_ID = os.environ.get("SWEEP_ID", "")
CONCURRENCY = int(os.environ.get("CONCURRENCY", "4"))
SPAN_CHARS = 6000
LIGHTNING_USD_PER_M = (0.06, 0.24)  # Nemotron 3.5 Lightning input / output, per million tokens
VM_USD_PER_HOUR = 0.068  # cpu-d3 2vcpu-8gb $0.066/h + 20 GiB network SSD $0.002/h; model tokens are not included


def _template_chars() -> dict:
    with open(os.path.join(HERE, "config", "prompts.yml"), encoding="utf-8") as f:
        parts = f.read().split("- task: ")[1:]
    return {p.split("\n", 1)[0].strip(): len(p) for p in parts}


TEMPLATE_CHARS = _template_chars()


def now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.000Z")


def sign(method: str, path: str, body: str) -> dict:
    ts = str(int(time.time()))
    mac = hmac.new(SECRET.encode(), f"{ts}.{method}.{path}.{body}".encode(), hashlib.sha256).hexdigest()
    return {"X-Probity-Timestamp": ts, "X-Probity-Signature": mac, "User-Agent": "probity-sweep/1.0", "Content-Type": "application/json"}


def call_app(method: str, path: str, payload: dict | None = None) -> dict:
    body = json.dumps(payload, separators=(",", ":")) if payload is not None else ""
    h = sign(method, path, body)
    # The app's /api proxy drops unknown headers, so the signature also travels in the query string.
    url = f"{APP_URL}{path}?pts={h['X-Probity-Timestamp']}&psig={h['X-Probity-Signature']}"
    req = urllib.request.Request(url, data=body.encode() if payload is not None else None, method=method, headers=h)
    with urllib.request.urlopen(req, timeout=60) as res:
        return json.loads(res.read() or b"{}")


def make_rails() -> LLMRails:
    os.environ["OPENAI_API_KEY"] = os.environ["NEBIUS_API_KEY"]
    return LLMRails(RailsConfig.from_path(os.path.join(HERE, "config")))


class Screen:
    """Counts what the rails did. Every check is one NeMo rail call (one Nemotron call)."""

    def __init__(self, rails: LLMRails):
        self.rails = rails
        self.gate = asyncio.Semaphore(CONCURRENCY)
        self.input_checks = self.input_flagged = self.output_checks = self.output_blocked = 0
        self.token_usd = 0.0

    def _bill(self, template_chars: int, text_chars: int) -> None:
        """Estimates the Token Factory cost of one rail call from its prompt and reply sizes (about 4 characters per token)."""
        prompt_tokens = (template_chars + text_chars) / 4
        self.token_usd += (prompt_tokens * LIGHTNING_USD_PER_M[0] + 2 * LIGHTNING_USD_PER_M[1]) / 1_000_000

    async def input_rail(self, text: str) -> bool:
        """True when the input rail BLOCKS the text (an instruction aimed at an automated reviewer)."""
        async with self.gate:
            res = await self.rails.check_async([{"role": "user", "content": text[:SPAN_CHARS]}], rail_types=[RailType.INPUT])
        self._bill(TEMPLATE_CHARS["self_check_input"], min(len(text), SPAN_CHARS))
        blocked = res.status == RailStatus.BLOCKED
        self.input_checks += 1
        self.input_flagged += int(blocked)
        return blocked

    async def output_rail(self, evidence: str, rationale: str) -> bool:
        """True when the output rail BLOCKS the rationale (it says something its evidence does not support)."""
        async with self.gate:
            res = await self.rails.check_async(
                [{"role": "user", "content": evidence[:SPAN_CHARS]}, {"role": "assistant", "content": rationale[:SPAN_CHARS]}],
                rail_types=[RailType.OUTPUT],
            )
        self._bill(TEMPLATE_CHARS["self_check_output"], min(len(evidence), SPAN_CHARS) + min(len(rationale), SPAN_CHARS))
        blocked = res.status == RailStatus.BLOCKED
        self.output_checks += 1
        self.output_blocked += int(blocked)
        return blocked


async def run_sweep(screen: Screen, started: float) -> dict:
    work = call_app("GET", "/api/sweep/work")
    requests = work.get("requests", [])
    flagged_ids: list[str] = []

    async def one(item: dict) -> None:
        spans = [s for s in item.get("spans", []) if s.get("text", "").strip()]
        results = await asyncio.gather(*[screen.input_rail(s["text"]) for s in spans])
        out_blocked = False
        if item.get("rationale"):
            evidence = "\n".join(f"- {e['label']}: {e['value']}" for e in item.get("evidence", []))
            out_blocked = await screen.output_rail(evidence or "(no evidence recorded)", item["rationale"])
        if any(results) or out_blocked:
            flagged_ids.append(item["requestId"])

    await asyncio.gather(*[one(r) for r in requests])
    return {
        "requestsSwept": len(requests),
        "recheckedRequestIds": [],
        "flaggedRequestIds": sorted(flagged_ids),
        "sweptRequestIds": [r["requestId"] for r in requests],
        "eval": None,
    }


async def run_eval(screen: Screen) -> dict:
    with open(os.path.join(HERE, "testset.json"), encoding="utf-8") as f:
        cases = json.load(f)["cases"]
    flags = await asyncio.gather(*[screen.input_rail(c["text"]) for c in cases])
    injected = [(c, f) for c, f in zip(cases, flags) if c["injection"]]
    clean = [(c, f) for c, f in zip(cases, flags) if not c["injection"]]
    detail = [{"id": c["id"], "injection": c["injection"], "flagged": f} for c, f in zip(cases, flags)]
    return {
        "requestsSwept": 0,
        "recheckedRequestIds": [],
        "flaggedRequestIds": [],
        "sweptRequestIds": [],
        "eval": {"cases": len(cases), "injected": len(injected), "caught": sum(1 for _, f in injected if f), "clean": len(clean), "falseAlarms": sum(1 for _, f in clean if f)},
        "evalDetail": detail,
    }


async def main() -> int:
    started = time.time()
    started_at = now()
    screen = Screen(make_rails())
    report = {"sweepId": SWEEP_ID, "mode": MODE, "startedAt": started_at}
    try:
        body = await (run_eval(screen) if MODE == "eval" else run_sweep(screen, started))
        report.update(body, state="completed")
    except Exception as exc:  # report a failed sweep instead of dying silently
        report.update(state="failed", error=f"{type(exc).__name__}: {str(exc)[:300]}", requestsSwept=0, recheckedRequestIds=[], flaggedRequestIds=[], sweptRequestIds=[], eval=None)
    report["finishedAt"] = now()
    report["nemo"] = {"spansChecked": screen.input_checks, "flagged": screen.input_flagged, "outputChecks": screen.output_checks, "outputBlocked": screen.output_blocked}
    report["costUsd"] = round((time.time() - started) / 3600 * VM_USD_PER_HOUR, 5)
    report["tokenCostUsd"] = round(screen.token_usd, 6)
    print("SWEEP_REPORT " + json.dumps(report, separators=(",", ":")), flush=True)
    if APP_URL and SECRET:
        try:
            call_app("POST", "/api/sweep/callback", report)
            print("callback posted", flush=True)
        except Exception as exc:
            print(f"callback failed: {type(exc).__name__}: {exc}", flush=True)
            return 2
    return 0 if report["state"] == "completed" else 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
