"use client";
import { useEffect, useState } from "react";
import type { AgentKey, Run, Step } from "@probity/shared";
import { dollars, MODEL_SHORT, seconds } from "@/lib/format";

const AGENT_MODELS: Record<AgentKey, string[]> = {
  letter_reader: ["Nemotron 3 Ultra"],
  registry_scout: ["Nemotron 3.5 Lightning", "Tavily"],
  identity_examiner: ["Nemotron 3 Ultra"],
  gate_officer: ["Nemotron 3.5 Lightning"],
  screen: ["Nemotron 3.5 Lightning"],
};
const STEP_MODELS: Record<string, string[]> = {
  read_text: ["Nemotron 3 Ultra"], pdf: ["code"], gate: ["code"],
};

export function Progress({ run }: { run: Run }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(t);
  }, []);
  const elapsed = now - new Date(run.startedAt).getTime();
  const done = run.steps.filter((s) => s.status === "done").length;
  const hidden = run.letter?.hidden.length ?? 0;
  const flags = run.screen?.flags.length ?? 0;

  return (
    <div className="progress-grid">
      <section className="card pad" aria-live="polite" aria-label="Check in progress">
        <div className="between">
          <p className="label" style={{ margin: 0 }}>{run.status === "queued" ? "Queued" : "Checking"} · {done} of {run.steps.length} steps</p>
          <span className="mono num muted" style={{ fontSize: 12 }}>{seconds(Math.max(0, elapsed))}</span>
        </div>
        <div style={{ height: 3, background: "var(--surface-2)", borderRadius: 2, margin: "12px 0 6px", overflow: "hidden" }}>
          <div style={{ height: "100%", width: `${(done / run.steps.length) * 100}%`, background: "var(--fg)", transition: "width .5s ease" }} />
        </div>
        <ol style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {run.steps.map((s) => <StepRow key={s.key} s={s} />)}
        </ol>
      </section>

      <aside style={{ display: "grid", gap: 16, alignContent: "start" }}>
        {(hidden > 0 || flags > 0) && (
          <section className="card pad rise" style={{ borderColor: "var(--hold-border)", background: "var(--hold-bg)" }}>
            <p className="label" style={{ margin: 0, color: "var(--hold)" }}>Found so far</p>
            {hidden > 0 && <p style={{ margin: "6px 0 0" }}><b>{hidden} {hidden === 1 ? "line" : "lines"}</b> in the letter that a person can&apos;t see.</p>}
            {flags > 0 && <p style={{ margin: "6px 0 0" }}><b>{flags} {flags === 1 ? "line" : "lines"}</b> addressed to an AI reviewer. They are treated as evidence, never as instructions.</p>}
          </section>
        )}
        <section className="card pad">
          <div className="between">
            <p className="label" style={{ margin: 0 }}>Model calls, live</p>
            <span className="mono num muted" style={{ fontSize: 12 }}>{dollars(run.calls.reduce((a, c) => a + c.costUsd, 0))}</span>
          </div>
          {run.calls.length === 0 && <p className="muted" style={{ margin: "8px 0 0", fontSize: 14 }}>The first call starts once the PDF is open.</p>}
          <ul style={{ listStyle: "none", margin: "8px 0 0", padding: 0, display: "grid", gap: 8 }}>
            {[...run.calls].reverse().slice(0, 7).map((c) => (
              <li key={c.id} className="rise" style={{ display: "grid", gap: 1, fontSize: 13.5 }}>
                <div className="between">
                  <b style={{ fontWeight: 500 }}>{MODEL_SHORT[c.model].name}</b>
                  <span className="mono num muted" style={{ fontSize: 12 }}>{seconds(c.ms)}</span>
                </div>
                <span className="muted">
                  {run.steps.find((s) => s.key === c.stepKey)?.label ?? c.stepKey}
                  {c.toolCalls.length > 0 && <> → <span className="mono" style={{ fontSize: 12 }}>{c.toolCalls.join(", ")}</span></>}
                </span>
              </li>
            ))}
          </ul>
        </section>
        {run.live && <p className="muted" style={{ fontSize: 13, margin: 0 }}>This is a live check: every model call is happening now on Nebius Token Factory. It usually takes one to three minutes.</p>}
      </aside>
      <style>{`.progress-grid { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(280px, 1fr); gap: 20px; align-items: start; } @media (max-width: 860px) { .progress-grid { grid-template-columns: 1fr; } }`}</style>
    </div>
  );
}

function StepRow({ s }: { s: Step }) {
  const models = STEP_MODELS[s.key] ?? (s.agent ? AGENT_MODELS[s.agent] : ["code"]);
  const ms = s.startedAt && s.finishedAt ? new Date(s.finishedAt).getTime() - new Date(s.startedAt).getTime() : null;
  const icon = s.status === "done" ? "✓" : s.status === "running" ? "●" : s.status === "failed" ? "✕" : s.status === "skipped" ? "–" : "○";
  const color = s.status === "failed" ? "var(--hold)" : s.status === "pending" || s.status === "skipped" ? "var(--muted)" : "var(--fg)";
  return (
    <li style={{ display: "grid", gridTemplateColumns: "22px 1fr auto", gap: 10, padding: "10px 0", borderTop: "1px solid var(--rule)", color }}>
      <span aria-hidden="true" className={s.status === "running" ? "pulse" : undefined} style={{ textAlign: "center" }}>{icon}</span>
      <div style={{ minWidth: 0 }}>
        <div>{s.label}</div>
        <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 3 }}>
          {models.map((m) => <span key={m} className="chip" style={{ fontSize: 10 }}>{m}</span>)}
        </div>
        {s.summary && <div className="muted" style={{ fontSize: 13.5, marginTop: 4 }}>{s.summary}</div>}
      </div>
      <span className="mono num muted" style={{ fontSize: 12 }}>{ms !== null ? seconds(ms) : ""}</span>
    </li>
  );
}
