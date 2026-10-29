import type { ModelCall, Run } from "@probity/shared";
import { dollars, MODEL_SHORT, seconds } from "@/lib/format";

const JOBS: Record<string, string> = {
  "nvidia/Nemotron-3-Ultra-550b-a55b": "Read the letter's claims and examined the vendor's identity",
  "nvidia/Nemotron-3.5-Super-VL": "Read the page image and planned the registry and web lookups",
  "nvidia/Nemotron-3_5-Lightning": "Screened every untrusted line and wrote the decision up",
};

export function byModel(calls: ModelCall[]) {
  const m = new Map<string, { calls: number; ms: number; tokens: number; cached: number; prompt: number; cost: number }>();
  for (const c of calls) {
    const x = m.get(c.model) ?? { calls: 0, ms: 0, tokens: 0, cached: 0, prompt: 0, cost: 0 };
    x.calls += 1; x.ms += c.ms; x.tokens += c.promptTokens + c.completionTokens; x.cached += c.cachedTokens; x.prompt += c.promptTokens; x.cost += c.costUsd;
    m.set(c.model, x);
  }
  return m;
}

/** Who did what: which NVIDIA Nemotron model on Nebius Token Factory did which job in this check. */
export function ModelsStrip({ run, onOpen }: { run: Run; onOpen?: () => void }) {
  const groups = byModel(run.calls);
  const cachedPct = run.totals.promptTokens ? Math.round((run.totals.cachedTokens / run.totals.promptTokens) * 100) : 0;
  return (
    <section className="card pad" aria-label="Who did what">
      <div className="between">
        <p className="label" style={{ margin: 0 }}>Who did what</p>
        <span className="muted" style={{ fontSize: 12 }}>Nebius Token Factory</span>
      </div>
      <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 12 }}>
        {Object.keys(JOBS).map((model) => {
          const g = groups.get(model);
          return (
            <li key={model} style={{ display: "grid", gap: 2, opacity: g ? 1 : 0.5 }}>
              <div className="between">
                <b style={{ fontWeight: 500 }}>{MODEL_SHORT[model].name}</b>
                <span className="mono muted num" style={{ fontSize: 12 }}>{g ? `${g.calls} ${g.calls === 1 ? "call" : "calls"} · ${seconds(g.ms)}` : "not used"}</span>
              </div>
              <span className="muted" style={{ fontSize: 13.5 }}>{JOBS[model]}</span>
            </li>
          );
        })}
        <li style={{ display: "grid", gap: 2 }}>
          <div className="between">
            <b style={{ fontWeight: 500 }}>Code</b>
            <span className="mono muted" style={{ fontSize: 12 }}>policy {run.decision?.policyVersion ?? ""}</span>
          </div>
          <span className="muted" style={{ fontSize: 13.5 }}>Checked the PDF for hidden text and applied the payment policy. No model can approve a payment.</span>
        </li>
      </ul>
      <div className="between mono num" style={{ borderTop: "1px solid var(--rule)", marginTop: 14, paddingTop: 10, fontSize: 12, flexWrap: "wrap", gap: 8 }}>
        <span>{dollars(run.totals.costUsd)} this check</span>
        {cachedPct > 0 && <span>{cachedPct}% of input cached</span>}
        {run.totals.tavilyCredits > 0 && <span>{run.totals.tavilyCredits} Tavily credits</span>}
      </div>
      {onOpen && <button onClick={onOpen} className="linkish" style={{ marginTop: 10 }}>Every call, with timings and tokens</button>}
    </section>
  );
}
