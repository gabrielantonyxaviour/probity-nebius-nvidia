// Live smoke test: starts real checks against a running `wrangler dev` (default http://127.0.0.1:8787) and prints the result.
// Costs about $0.05 per check on Token Factory. Usage: npm run smoke:live -w engine -- BCR-2026-0407 BCR-2026-0412
import fs from "node:fs";
import path from "node:path";
import { Run } from "@probity/shared";

const base = process.env.ENGINE_URL ?? "http://127.0.0.1:8787";
const ids = process.argv.slice(2).filter((a) => /^[A-Za-z0-9-]+$/.test(a));
const requests = ids.length ? ids : ["BCR-2026-0407"];

function hasKey(): boolean {
  if (process.env.NEBIUS_API_KEY) return true;
  const f = path.resolve(import.meta.dirname, "../.dev.vars");
  return fs.existsSync(f) && /^NEBIUS_API_KEY=.+/m.test(fs.readFileSync(f, "utf8"));
}

let cookie = "";
async function api(p: string, init: RequestInit = {}): Promise<Response> {
  const res = await fetch(base + p, { ...init, headers: { "content-type": "application/json", cookie, ...(init.headers ?? {}) } });
  const set = res.headers.get("set-cookie");
  if (set) cookie = set.split(";")[0]!;
  return res;
}

async function check(requestId: string): Promise<boolean> {
  const t0 = Date.now();
  const start = await api("/api/checks", { method: "POST", body: JSON.stringify({ requestId }) });
  const started = (await start.json()) as { runId?: string; error?: string; code?: string };
  if (!started.runId) {
    process.stdout.write(`${requestId}: could not start (${start.status} ${started.code ?? ""} ${started.error ?? ""})\n`);
    return false;
  }
  let run: Run | null = null;
  while (Date.now() - t0 < 6 * 60_000) {
    const r = Run.parse(await (await api(`/api/runs/${started.runId}`)).json());
    run = r;
    if (r.status === "done" || r.status === "failed") break;
    await new Promise((res) => setTimeout(res, 1500));
  }
  if (!run) return false;
  const out = [`\n=== ${requestId} -> ${run.id} (${run.status}, ${((Date.now() - t0) / 1000).toFixed(0)} s)`];
  for (const s of run.steps) out.push(`  ${s.status.padEnd(8)} ${s.key.padEnd(11)} ${s.summary ?? ""}`);
  const d = run.decision;
  if (d) {
    out.push(`  verdict ${d.verdict}${d.callCard.phone ? `, call ${d.callCard.phone}` : ""}  (rationale checked: ${d.rationaleChecked})`);
    for (const r of d.reasons) out.push(`    [${r.severity}] ${r.text}`);
    out.push(`  note: ${d.rationale}`);
  }
  if (run.error) out.push(`  error: ${run.error}`);
  const t = run.totals;
  out.push(`  ${run.calls.length} model calls, ${t.promptTokens} in (${t.cachedTokens} cached) / ${t.completionTokens} out, $${t.costUsd.toFixed(4)}, tavily credits ${t.tavilyCredits}`);
  process.stdout.write(out.join("\n") + "\n");
  return run.status === "done";
}

async function main() {
  if (!hasKey()) {
    process.stdout.write("NEBIUS_API_KEY is not set (env or engine/.dev.vars); skipping the live smoke test.\n");
    return;
  }
  let ok = true;
  for (const id of requests) ok = (await check(id)) && ok;
  process.exitCode = ok ? 0 : 1;
}
void main();
