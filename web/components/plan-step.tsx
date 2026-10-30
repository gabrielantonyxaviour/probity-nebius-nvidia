"use client";
import { useState } from "react";
import { account, ApiFailure } from "@/lib/api";

const FREE = ["100 checks a month", "Every feature: mailboxes, Xero, Slack, pre-run re-checks", "No card needed"];
const PLUS = ["1,000 checks a month", "Everything in Free", "$49 per company per month, in US dollars", "Cancel any time"];

/** The last setup step: Free goes straight on; Plus opens Dodo checkout; a judge's code opens a $0 Dodo checkout. */
export function PlanStep({ preferPlus, onDone }: { preferPlus: boolean; onDone: () => void }) {
  const [busy, setBusy] = useState<"plus" | "code" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [code, setCode] = useState("");

  async function plus() {
    setBusy("plus"); setError(null);
    try { window.location.assign((await account.checkout()).url); }
    catch (e) { setError(e instanceof ApiFailure ? e.message : "Couldn't open the payment page. Try again."); setBusy(null); }
  }
  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy("code"); setError(null);
    try { window.location.assign((await account.redeem(code.trim())).url); }
    catch (err) { setError(err instanceof ApiFailure ? err.message : "That code didn't work."); setBusy(null); }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="plan-grid">
        <section className="card plan" aria-label="Free">
          <p className="label" style={{ margin: 0 }}>Free</p>
          <p className="serif plan-price">$0</p>
          <ul>{FREE.map((i) => <li key={i}><span aria-hidden="true">✓</span>{i}</li>)}</ul>
          <button className={`btn${preferPlus ? "" : " primary"}`} onClick={onDone} disabled={!!busy}>Start free</button>
        </section>
        <section className="card plan" aria-label="Probity Plus" style={{ borderColor: "var(--fg)" }}>
          <p className="label" style={{ margin: 0 }}>Probity Plus</p>
          <p className="serif plan-price">$49<span className="muted"> / month</span></p>
          <ul>{PLUS.map((i) => <li key={i}><span aria-hidden="true">✓</span>{i}</li>)}</ul>
          <button className={`btn${preferPlus ? " primary" : ""}`} onClick={plus} disabled={!!busy}>{busy === "plus" ? "Opening checkout…" : "Continue to checkout"}</button>
        </section>
      </div>
      <form onSubmit={redeem} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
        <label className="muted" htmlFor="plan-code" style={{ fontSize: 14 }}>Have a code?</label>
        <input id="plan-code" className="field" value={code} onChange={(e) => setCode(e.target.value)} placeholder="NEBIUSJUDGES" autoComplete="off" style={{ maxWidth: 220, minHeight: 38 }} />
        <button className="btn" disabled={!!busy || !code.trim()}>{busy === "code" ? "Applying…" : "Apply"}</button>
      </form>
      {error && <p role="alert" style={{ margin: 0, color: "var(--hold)" }}>{error}</p>}
      <p className="muted" style={{ margin: 0, fontSize: 13 }}>Payments by Dodo Payments, merchant of record. You can switch plans later under Settings, Plan and billing.</p>
      <style>{`
        .plan-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 14px; }
        .plan { padding: 22px; display: grid; gap: 12px; align-content: start; }
        .plan-price { font-size: 44px; line-height: 1; margin: 0; }
        .plan-price span { font-size: 16px; }
        .plan ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; font-size: 14.5px; }
        .plan li { display: flex; gap: 8px; }
        .plan li span { color: var(--approve); }
        @media (max-width: 640px) { .plan-grid { grid-template-columns: 1fr; } }
      `}</style>
    </div>
  );
}
