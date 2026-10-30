"use client";
import { useState } from "react";

// The model calls of a real check (GM-20261030-B11A68, a bank-change e-mail that arrived through Gmail on 30 Oct 2026).
const ROWS: Array<[string, string, boolean, string, string]> = [
  ["Screen every line for orders aimed at an AI", "Nemotron 3.5 Lightning", false, "2.3 s", "$0.0001"],
  ["Read what the letter asks", "Nemotron 3 Ultra", true, "8.5 s", "$0.0093"],
  ["Check registries and the vendor master ×6", "Nemotron 3.5 Lightning", false, "3.8 s", "$0.0007"],
  ["Screen the vendor's web pages", "Nemotron 3.5 Lightning", false, "0.4 s", "$0.0001"],
  ["Link each claim to the evidence", "Nemotron 3 Ultra", true, "4.9 s", "$0.0068"],
  ["Write the note for the clerk", "Nemotron 3.5 Lightning", false, "0.6 s", "$0.0000"],
];

export function Ledger() {
  const [tab, setTab] = useState<"calls" | "decision">("calls");
  return (
    <div className="lp-panel">
      <div className="lp-panel-head lp-mono" role="group" aria-label="View">
        <button aria-pressed={tab === "calls"} onClick={() => setTab("calls")}>Model calls</button>
        <button aria-pressed={tab === "decision"} onClick={() => setTab("decision")}>Decision</button>
      </div>
      {tab === "calls" ? (
        <div style={{ overflowX: "auto" }}>
          <table className="lp-table">
            <thead><tr><th>Step</th><th>Model</th><th>Thinking</th><th>Time</th><th>Cost</th></tr></thead>
            <tbody>
              {ROWS.map(([step, model, think, time, cost]) => (
                <tr key={step}><td>{step}</td><td>{model}</td><td className={think ? "on" : ""}>{think ? "on" : "off"}</td><td>{time}</td><td>{cost}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
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
      <div className="lp-panel-foot lp-mono" style={{ fontSize: 11 }}>
        <span>GM-20261030-B11A68 · arrived by Gmail</span><span>Total $0.017 · 11 calls</span>
      </div>
    </div>
  );
}
