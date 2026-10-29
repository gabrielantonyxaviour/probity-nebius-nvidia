import type { Run } from "@probity/shared";
import { dollars, MODEL_SHORT, seconds } from "@/lib/format";

/** Every model call in the check: the run's own audit trail of what ran on Nebius Token Factory. */
export function Ledger({ run }: { run: Run }) {
  const label = (key: string) => run.steps.find((s) => s.key === key)?.label ?? key;
  return (
    <section className="card">
      <div className="between" style={{ padding: "16px 20px 6px", flexWrap: "wrap" }}>
        <p className="label" style={{ margin: 0 }}>Model calls · Nebius Token Factory</p>
        <span className="mono muted num" style={{ fontSize: 12 }}>
          {run.calls.length} calls · {run.totals.promptTokens.toLocaleString()} in ({run.totals.cachedTokens.toLocaleString()} cached) · {run.totals.completionTokens.toLocaleString()} out · {dollars(run.totals.costUsd)}
        </span>
      </div>
      <div className="tablewrap">
        <table className="t">
          <thead>
            <tr><th>Step</th><th>Model</th><th>Thinking</th><th style={{ textAlign: "right" }}>Time</th><th style={{ textAlign: "right" }}>Tokens in / cached / out</th><th style={{ textAlign: "right" }}>Cost</th><th>Tools chosen</th></tr>
          </thead>
          <tbody>
            {run.calls.map((c) => (
              <tr key={c.id}>
                <td>{label(c.stepKey)}</td>
                <td style={{ whiteSpace: "nowrap" }}>{MODEL_SHORT[c.model].name}<div className="mono muted" style={{ fontSize: 11 }}>{c.model}</div></td>
                <td>{c.thinking ? "on" : "off"}</td>
                <td className="num mono" style={{ textAlign: "right", fontSize: 13 }}>{seconds(c.ms)}</td>
                <td className="num mono" style={{ textAlign: "right", fontSize: 13, whiteSpace: "nowrap" }}>{c.promptTokens.toLocaleString()} / {c.cachedTokens.toLocaleString()} / {c.completionTokens.toLocaleString()}</td>
                <td className="num mono" style={{ textAlign: "right", fontSize: 13 }}>{dollars(c.costUsd)}</td>
                <td className="mono" style={{ fontSize: 12 }}>{c.toolCalls.join(", ") || "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="muted" style={{ margin: 0, padding: "10px 20px 14px", fontSize: 12.5 }}>
        Costs use Token Factory&apos;s published per-token prices, with cached input at the cached rate. Steps: {run.steps.map((s) => `${s.label.toLowerCase()}${s.summary ? ` (${s.summary})` : ""}`).join(" → ")}.
      </p>
    </section>
  );
}
