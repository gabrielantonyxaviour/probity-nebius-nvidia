"use client";
import type { Evidence, Run, Source } from "@probity/shared";
import { api } from "@/lib/api";
import { SOURCE_LABEL } from "@/lib/format";
import { useData } from "@/lib/use-data";
import { SweepCard } from "../sweep-card";
import { Ledger } from "./ledger";

const ORDER: Source[] = ["sec_edgar", "usaspending", "gleif", "tavily", "vendor_master", "request"];
const KIND: Record<Source, { chip: string; note: string }> = {
  sec_edgar: { chip: "real", note: "Live public registry" },
  usaspending: { chip: "real", note: "Live public registry" },
  gleif: { chip: "real", note: "Live public registry" },
  tavily: { chip: "real", note: "The vendor's own website, found and read by Tavily" },
  vendor_master: { chip: "synth", note: "Our company's records (synthetic)" },
  request: { chip: "hold", note: "From the request itself: never trusted" },
};

export function EvidenceTab({ run, focus }: { run: Run; focus: string | null }) {
  const sweep = useData(() => api.sweep(), []);
  const d = run.decision!;
  const bySource = ORDER.map((s) => [s, run.evidence.filter((e) => e.source === s)] as const).filter(([, list]) => list.length > 0);
  const cited = new Map<string, string[]>();
  d.reasons.forEach((r) => r.evidenceIds.forEach((id) => cited.set(id, [...(cited.get(id) ?? []), r.text])));

  return (
    <div id="evidence-top" style={{ display: "grid", gap: 20 }}>
      <section className="card pad">
        <p className="label" style={{ margin: "0 0 10px" }}>Every finding · policy {d.policyVersion}</p>
        <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gap: 8 }}>
          {d.reasons.map((r) => (
            <li key={r.code + r.text} className="row" style={{ alignItems: "baseline", gap: 10 }}>
              <span className={`chip ${r.severity === "info" ? "" : r.severity}`} style={{ minWidth: 74, justifyContent: "center" }}>{r.severity === "callback" ? "call" : r.severity}</span>
              <span style={{ flex: 1 }}>{r.text}</span>
              <span className="mono muted" style={{ fontSize: 12 }}>{r.code}</span>
            </li>
          ))}
        </ul>
      </section>

      {run.screen && (
        <section className="card pad">
          <div className="between" style={{ flexWrap: "wrap" }}>
            <p className="label" style={{ margin: 0 }}>Instruction screen</p>
            <span className="muted" style={{ fontSize: 13 }}>{run.screen.spansScreened} lines from the letter, e-mail and web pages</span>
          </div>
          {run.screen.flags.length === 0 ? (
            <p style={{ margin: "8px 0 0" }}>No line tried to instruct an AI reviewer.</p>
          ) : (
            <ul style={{ listStyle: "none", margin: "10px 0 0", padding: 0, display: "grid", gap: 10 }}>
              {run.screen.flags.map((f, i) => (
                <li key={i} style={{ borderLeft: "3px solid var(--hold)", paddingLeft: 10 }}>
                  <p className="mono" style={{ margin: 0, fontSize: 12.5, overflowWrap: "anywhere" }}>&ldquo;{f.text}&rdquo;</p>
                  <p className="muted" style={{ margin: "3px 0 0", fontSize: 13 }}>
                    {f.why} · from the {f.source} · {f.by === "lightning" ? "Nemotron 3.5 Lightning" : f.by === "nemo_input_rail" ? "NeMo Guardrails input rail" : "Nemotron content safety"}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </section>
      )}

      <section className="card">
        <div style={{ padding: "16px 20px 6px" }}><p className="label" style={{ margin: 0 }}>Fact sheet · {run.evidence.length} facts</p></div>
        {bySource.length === 0 && <p className="muted" style={{ padding: "0 20px 16px", margin: 0 }}>No registry or web facts were found for this vendor.</p>}
        {bySource.map(([source, list]) => (
          <div key={source} style={{ borderTop: "1px solid var(--rule)", padding: "12px 20px" }}>
            <div className="row" style={{ gap: 8, marginBottom: 8, flexWrap: "wrap" }}>
              <span className={`chip ${KIND[source].chip}`}>{SOURCE_LABEL[source]}</span>
              <span className="muted" style={{ fontSize: 13 }}>{KIND[source].note}</span>
            </div>
            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "minmax(140px, 220px) 1fr", gap: "6px 14px" }}>
              {list.map((e) => <Fact key={e.id} e={e} focus={focus === e.id} usedBy={cited.get(e.id)} />)}
            </dl>
          </div>
        ))}
      </section>

      <Ledger run={run} />
      <SweepCard sweep={sweep.data ?? null} />
    </div>
  );
}

function Fact({ e, focus, usedBy }: { e: Evidence; focus: boolean; usedBy?: string[] }) {
  return (
    <div id={e.id} style={{ display: "contents" }}>
      <dt className="muted" style={{ fontSize: 14 }}>{e.label}</dt>
      <dd style={{ margin: 0, fontSize: 14, padding: focus ? "2px 6px" : 0, borderRadius: 4, background: focus ? "var(--info-bg)" : undefined, overflowWrap: "anywhere" }}>
        {e.value}
        {e.url && <> · <a href={e.url} target="_blank" rel="noreferrer" className="muted" style={{ fontSize: 12.5 }}>source ↗</a></>}
        {e.cached && <span className="muted" style={{ fontSize: 12 }}> · cached</span>}
        {usedBy && <span className="muted" style={{ display: "block", fontSize: 12.5 }}>Used for: {usedBy[0]}</span>}
      </dd>
    </div>
  );
}
