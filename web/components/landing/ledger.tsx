"use client";
import { useState } from "react";

// The model calls of a real check (GM-20261030-B11A68, a bank-change e-mail that arrived through Gmail on 30 Oct 2026),
// drawn as a timeline: each bar starts where the previous step ended and its length is the call's time.
type Row = { step: string; model: "Ultra" | "Lightning"; think: boolean; s: number; cost: string; calls: number };
const ROWS: Row[] = [
  { step: "Screen every line for orders aimed at an AI", model: "Lightning", think: false, s: 2.3, cost: "$0.0001", calls: 1 },
  { step: "Read what the letter asks", model: "Ultra", think: true, s: 8.5, cost: "$0.0093", calls: 1 },
  { step: "Registries and the vendor master", model: "Lightning", think: false, s: 3.8, cost: "$0.0007", calls: 6 },
  { step: "Screen the vendor's web pages", model: "Lightning", think: false, s: 0.4, cost: "$0.0001", calls: 1 },
  { step: "Link each claim to the evidence", model: "Ultra", think: true, s: 4.9, cost: "$0.0068", calls: 1 },
  { step: "Write the note for the clerk", model: "Lightning", think: false, s: 0.6, cost: "<$0.0001", calls: 1 },
];
const TOTAL = ROWS.reduce((a, r) => a + r.s, 0);

export function Ledger() {
  const [tab, setTab] = useState<"calls" | "decision">("calls");
  let at = 0;
  return (
    <div className="lp-panel">
      <div className="lp-panel-top">
        <div style={{ display: "grid", gap: 4, minWidth: 0 }}>
          <span className="lp-mono lp-muted" style={{ fontSize: 11 }}>GM-20261030-B11A68 · arrived by Gmail</span>
          <span style={{ fontSize: 17 }}>Sable Harbor Marine Logistics LLC</span>
        </div>
        <span className="lp-verdict lp-mono hold">✕ Hold</span>
      </div>
      <div className="lp-panel-head lp-mono" role="group" aria-label="View">
        <button aria-pressed={tab === "calls"} onClick={() => setTab("calls")}>Model calls</button>
        <button aria-pressed={tab === "decision"} onClick={() => setTab("decision")}>Decision</button>
        <span className="lp-legend"><i className="u" />Ultra · reasoning on<i className="l" />Lightning · fast</span>
      </div>
      {tab === "calls" ? (
        <ol className="lp-trace">
          {ROWS.map((r) => {
            const left = (at / TOTAL) * 100, width = Math.max(1.2, (r.s / TOTAL) * 100);
            at += r.s;
            return (
              <li key={r.step}>
                <div className="lp-trace-label">
                  <span>{r.step}{r.calls > 1 && <em className="lp-mono"> ×{r.calls}</em>}</span>
                  <span className="lp-mono lp-trace-model">Nemotron {r.model === "Ultra" ? "3 Ultra" : "3.5 Lightning"}{r.think ? " · thinking" : ""}</span>
                </div>
                <div className="lp-trace-track"><span className={`lp-trace-bar ${r.model === "Ultra" ? "u" : "l"}`} style={{ left: `${left}%`, width: `${width}%` }} /></div>
                <span className="lp-mono lp-trace-num">{r.s.toFixed(1)} s</span>
                <span className="lp-mono lp-trace-num">{r.cost}</span>
              </li>
            );
          })}
        </ol>
      ) : (
        <pre className="lp-json">{"{\n  "}<span className="k">&quot;verdict&quot;</span>: <span className="h">&quot;HOLD&quot;</span>,{"\n  "}
          <span className="k">&quot;decided_by&quot;</span>: <span className="s">&quot;policy pp-2026-10-30.1 (code)&quot;</span>,{"\n  "}
          <span className="k">&quot;reasons&quot;</span>: [{"\n    "}
          <span className="s">&quot;H1 The e-mail came from gmail.com, not a domain on file&quot;</span>,{"\n    "}
          <span className="s">&quot;C1 No call-back to an independent number is on record&quot;</span>{"\n  "}],{"\n  "}
          <span className="k">&quot;call&quot;</span>: <span className="s">&quot;(757) 555-0190&quot;</span>, <span className="k">&quot;from&quot;</span>: <span className="s">&quot;vendor master&quot;</span>,{"\n  "}
          <span className="k">&quot;not_this_number&quot;</span>: <span className="h">&quot;(757) 555-0148&quot;</span>{"\n}"}
        </pre>
      )}
      <div className="lp-panel-stats">
        <div><span className="lp-mono lp-muted">Model calls</span><b>11</b></div>
        <div><span className="lp-mono lp-muted">Model time</span><b>{TOTAL.toFixed(1)} s</b></div>
        <div><span className="lp-mono lp-muted">Cost</span><b>$0.017</b></div>
        <div><span className="lp-mono lp-muted">Decided by</span><b>Code</b></div>
      </div>
    </div>
  );
}
