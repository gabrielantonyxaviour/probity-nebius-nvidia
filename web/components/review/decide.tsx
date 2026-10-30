"use client";
import type { Run } from "@probity/shared";
import { VERDICT } from "@/lib/format";
import { CallCard } from "./call-card";
import { LetterView } from "./letter-view";
import { ModelsStrip } from "./models-strip";

const GLYPH = { hold: "✕", callback: "☏", info: "·" } as const;
const TONE = { hold: "var(--hold)", callback: "var(--callback)", info: "var(--muted)" } as const;

export function Decide({ run, letterKey, onEvidence, onChanged }: { run: Run; letterKey?: string; onEvidence: (id: string | null) => void; onChanged: () => void }) {
  const d = run.decision!;
  const final = d.finalVerdict;
  const v = VERDICT[final];
  const tone = `var(--${v.chip})`;
  const changedByCall = d.outcome && final !== d.verdict;

  return (
    <div className="decide-grid">
      <div className="decide-main" style={{ display: "grid", gap: 18, minWidth: 0 }}>
        <section className="card rise o-verdict" style={{ padding: "22px 24px", borderColor: `var(--${v.chip}-border)`, background: `color-mix(in srgb, var(--${v.chip}-bg) 55%, var(--surface))` }}>
          <p className="label" style={{ margin: 0 }}>{d.outcome ? "Decision after the call" : "Probity's decision"}</p>
          <p className="serif" style={{ fontSize: "clamp(40px, 6vw, 58px)", lineHeight: 1, margin: "8px 0 8px", color: tone }}>{v.word}</p>
          <p style={{ margin: 0, fontSize: 17 }}>{v.line}</p>
          {changedByCall && <p className="muted" style={{ margin: "8px 0 0" }}>Probity said {VERDICT[d.verdict].word.toLowerCase()}; the call settled it.</p>}

          <ol style={{ listStyle: "none", margin: "20px 0 0", padding: 0, display: "grid", gap: 10 }}>
            {d.reasons.slice(0, 3).map((r) => (
              <li key={r.code + r.text} style={{ display: "grid", gridTemplateColumns: "22px 1fr", gap: 8, alignItems: "baseline" }}>
                <span aria-hidden="true" style={{ color: TONE[r.severity], fontWeight: 600, textAlign: "center" }}>{GLYPH[r.severity]}</span>
                <span>
                  {r.text}{" "}
                  {r.evidenceIds.length > 0 && (
                    <button onClick={() => onEvidence(r.evidenceIds[0])} className="linkish">See source</button>
                  )}
                </span>
              </li>
            ))}
          </ol>
          {d.reasons.length > 3 && (
            <button onClick={() => onEvidence(null)} className="linkish" style={{ marginTop: 10 }}>
              {d.reasons.length - 3} more {d.reasons.length - 3 === 1 ? "finding" : "findings"} in Evidence
            </button>
          )}
        </section>

        <div className="o-letter"><LetterView run={run} letterKey={letterKey} /></div>

        <section className="card pad o-why">
          <div className="between" style={{ flexWrap: "wrap" }}>
            <p className="label" style={{ margin: 0 }}>Why, in full</p>
            <span className="muted" style={{ fontSize: 12.5 }}>
              Written by Nemotron 3.5 Lightning{d.rationaleChecked ? " · every number checked against the evidence" : ""}
            </span>
          </div>
          <p style={{ margin: "8px 0 0", fontSize: 15.5 }}>{d.rationale}</p>
        </section>
      </div>

      <aside className="decide-side" style={{ display: "grid", gap: 18, alignContent: "start" }}>
        <div className="o-call"><CallCard run={run} onChanged={onChanged} onEvidence={onEvidence} /></div>
        <div className="o-models"><ModelsStrip run={run} onOpen={() => onEvidence(null)} /></div>
      </aside>
      <style>{`
        .decide-grid { display: grid; grid-template-columns: minmax(0, 1.55fr) minmax(300px, 1fr); gap: 22px; align-items: start; }
        .decide-side { position: sticky; top: 76px; }
        .linkish { background: none; border: 0; padding: 0; color: var(--fg-2); text-decoration: underline; text-underline-offset: 3px; cursor: pointer; font-size: 14px; }
        @media (max-width: 900px) { .decide-grid { grid-template-columns: 1fr; gap: 18px; } .decide-main, .decide-side { display: contents; } .o-verdict { order: 1; } .o-call { order: 2; } .o-letter { order: 3; } .o-why { order: 4; } .o-models { order: 5; } }
      `}</style>
    </div>
  );
}
