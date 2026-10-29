"use client";
import { useState } from "react";
import type { Run } from "@probity/shared";
import { api, ApiFailure } from "@/lib/api";
import { SOURCE_LABEL, time } from "@/lib/format";

type Result = "confirmed" | "denied" | "no_answer";
const OUTCOME: Record<Result, string> = {
  confirmed: "Vendor confirmed the change",
  denied: "Vendor didn't send it",
  no_answer: "No answer yet",
};

export function CallCard({ run, onChanged, onEvidence }: { run: Run; onChanged: () => void; onEvidence: (id: string) => void }) {
  const d = run.decision!;
  const card = d.callCard;
  const [busy, setBusy] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);
  const needsCall = d.verdict !== "APPROVE";
  const isHold = d.verdict === "HOLD";

  async function log(result: Result) {
    setBusy(result);
    setError(null);
    try {
      await api.logOutcome(run.id, result, null);
      onChanged();
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Couldn't save the outcome. Try again.");
    } finally {
      setBusy(null);
    }
  }

  if (!needsCall) {
    return (
      <section className="card pad">
        <p className="label" style={{ margin: 0 }}>Call-back</p>
        <p style={{ margin: "8px 0 0" }}>No call needed: every detail matches what we already hold for this vendor.</p>
      </section>
    );
  }

  return (
    <section className="card rise" style={{ padding: "20px 22px" }} aria-label="Call the vendor">
      <p className="label" style={{ margin: 0 }}>{isHold ? "Warn the vendor. Call them on" : "Before paying, call"}</p>
      {card.phone ? (
        <a href={`tel:${card.phone.replace(/[^\d+]/g, "")}`} className="mono num" style={{ display: "block", fontSize: 30, fontWeight: 500, letterSpacing: "-0.01em", margin: "6px 0 10px", textDecoration: "none" }}>
          {card.phone}
        </a>
      ) : (
        <p style={{ margin: "8px 0 10px" }}>No independent number found. Use one from an earlier invoice or contract, never the letter.</p>
      )}
      {card.sources.length > 0 && (
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {card.sources.map((s) => (
            <button key={s.evidenceId} onClick={() => onEvidence(s.evidenceId)} className={`chip ${s.source === "vendor_master" ? "synth" : "real"}`} style={{ cursor: "pointer" }} title="Open the source in Evidence">
              {SOURCE_LABEL[s.source]}
            </button>
          ))}
        </div>
      )}
      {card.sources.length > 1 && <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>Two sources agree. Neither came from the letter.</p>}
      {card.letterPhones.length > 0 && (
        <p style={{ fontSize: 14, margin: "12px 0 0" }}>
          <span className="muted">Not the letter&apos;s number: </span>
          {card.letterPhones.map((p) => <s key={p} className="mono" style={{ color: "var(--hold)", marginRight: 8 }}>{p}</s>)}
        </p>
      )}
      {card.ask.length > 0 && (
        <>
          <p className="label" style={{ margin: "16px 0 6px" }}>Ask</p>
          <ul style={{ margin: 0, paddingLeft: 18, display: "grid", gap: 4 }}>{card.ask.map((a) => <li key={a}>{a}</li>)}</ul>
        </>
      )}

      <div style={{ borderTop: "1px solid var(--rule)", marginTop: 18, paddingTop: 14 }}>
        {d.outcome && d.outcome.result !== "no_answer" ? (
          <p style={{ margin: 0 }}><b>{OUTCOME[d.outcome.result]}</b> <span className="muted">· {d.outcome.by}, {time(d.outcome.at)}</span></p>
        ) : (
          <>
            <p className="label" style={{ margin: "0 0 8px" }}>After the call</p>
            {d.outcome && <p className="muted" style={{ fontSize: 13, margin: "0 0 8px" }}>No answer at {time(d.outcome.at)}. Try again before the cut-off.</p>}
            <div style={{ display: "grid", gap: 8 }}>
              {!isHold && <button className="btn approve" onClick={() => log("confirmed")} disabled={!!busy}>{busy === "confirmed" ? "Saving…" : "✓ Vendor confirmed the change"}</button>}
              <button className="btn hold" onClick={() => log("denied")} disabled={!!busy}>{busy === "denied" ? "Saving…" : "✕ Vendor didn't send it"}</button>
              {!d.outcome && <button className="btn" onClick={() => log("no_answer")} disabled={!!busy}>{busy === "no_answer" ? "Saving…" : "No answer yet"}</button>}
            </div>
            {isHold && <p className="muted" style={{ fontSize: 13, margin: "8px 0 0" }}>A hold stays a hold. The call tells the vendor someone is impersonating them.</p>}
          </>
        )}
        {error && <p role="alert" style={{ color: "var(--hold)", margin: "8px 0 0", fontSize: 14 }}>{error}</p>}
      </div>
    </section>
  );
}
