"use client";
import { useState } from "react";
import { account, ApiFailure } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useData } from "@/lib/use-data";
import { ErrorBox, Skeleton } from "../states";

const JUDGE_CODE = "NEBIUSJUDGES"; // the public 100%-off code; the engine accepts only this literal

const STATUS: Record<string, string> = {
  none: "", active: "Active", on_hold: "Payment on hold: update your card in the billing portal", cancelled: "Cancelled", failed: "Last payment failed",
};

/** Plan, usage and the Dodo Payments checkout / portal. A judge's code opens a $0 checkout, so the subscription is real. */
export function BillingPanel({ canEdit }: { canEdit: boolean }) {
  const b = useData(() => account.billing(), []);
  const [busy, setBusy] = useState<"checkout" | "portal" | "redeem" | "judge" | null>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function go(kind: "checkout" | "portal" | "judge") {
    setBusy(kind); setError(null);
    try {
      const { url } = kind === "portal" ? await account.portal() : await account.checkout(kind === "judge" ? JUDGE_CODE : undefined);
      window.location.assign(url);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : "Couldn't open the payment page. Try again.");
      setBusy(null);
    }
  }
  async function redeem(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy("redeem"); setError(null);
    try {
      window.location.assign((await account.redeem(code.trim())).url);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "That code didn't work.");
      setBusy(null);
    }
  }

  if (b.error) return <ErrorBox error={b.error} onRetry={b.reload} />;
  if (!b.data) return <div className="stack"><Skeleton h={80} /></div>;
  const d = b.data;
  const pro = d.plan === "pro";
  const granted = pro && !d.hasSubscription; // Pro without a Dodo subscription: nothing to renew or manage
  const used = Math.min(1, d.limits.checksPerMonth ? d.limits.checksUsed / d.limits.checksPerMonth : 0);

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <div className="card" style={{ padding: "18px 20px", display: "grid", gap: 12 }}>
        <div className="between" style={{ flexWrap: "wrap" }}>
          <div>
            <p className="label" style={{ margin: 0 }}>Current plan</p>
            <p className="serif" style={{ fontSize: 30, margin: "4px 0 0" }}>{pro ? "Probity Pro" : "Free"}</p>
          </div>
          {pro && d.hasSubscription && d.status !== "none" && <span className={`chip ${d.status === "active" ? "approve" : "callback"}`}>{STATUS[d.status]}</span>}
        </div>
        <div>
          <div className="between" style={{ fontSize: 14 }}>
            <span>Checks this month</span>
            <span className="num mono">{d.limits.checksUsed} of {d.limits.checksPerMonth}</span>
          </div>
          <div style={{ height: 6, borderRadius: 3, background: "var(--surface-2)", marginTop: 6, overflow: "hidden" }}>
            <div style={{ width: `${used * 100}%`, height: "100%", background: used > 0.9 ? "var(--hold)" : "var(--fg)" }} />
          </div>
        </div>
        {granted && <p className="muted" style={{ margin: 0, fontSize: 14 }}>Pro granted by the judges' code, no subscription yet.</p>}
        {pro && d.hasSubscription && d.renewsAt && <p className="muted" style={{ margin: 0, fontSize: 14 }}>Renews {dateTime(d.renewsAt)} · {d.priceLabel}</p>}
        {canEdit && (granted ? (
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <button className="btn primary" onClick={() => go("judge")} disabled={!!busy}>{busy === "judge" ? "Opening checkout…" : "Create the $0 subscription"}</button>
            <span className="muted" style={{ fontSize: 13 }}>Free with the judges' code. No card needed.</span>
          </div>
        ) : pro ? (
          d.hasSubscription && d.status !== "none" && <button className="btn" style={{ justifySelf: "start" }} onClick={() => go("portal")} disabled={!!busy}>{busy === "portal" ? "Opening…" : "Manage billing"}</button>
        ) : (
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            <button className="btn primary" onClick={() => go("checkout")} disabled={!!busy}>{busy === "checkout" ? "Opening checkout…" : `Upgrade to Probity Pro · ${d.priceLabel}`}</button>
            <span className="muted" style={{ fontSize: 13 }}>Secure checkout by Dodo Payments. Cancel any time.</span>
          </div>
        ))}
      </div>

      {!pro && canEdit && (
        <form onSubmit={redeem} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <input className="field" style={{ maxWidth: 260 }} value={code} onChange={(e) => setCode(e.target.value)} placeholder="Have a code?" aria-label="Access code" />
          <button className="btn" disabled={busy === "redeem" || !code.trim()}>{busy === "redeem" ? "Checking…" : "Apply code"}</button>
        </form>
      )}
      {error && <p role="alert" style={{ margin: 0, color: "var(--hold)" }}>{error}</p>}
    </div>
  );
}
