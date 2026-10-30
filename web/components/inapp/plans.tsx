"use client";
import Link from "next/link";
import type { Billing, Me } from "@probity/shared";
import { account } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { Skeleton } from "../states";
import "./inapp.css";

const BILLING = "/app/settings?tab=billing";

const PLANS = [
  { key: "free", name: "Free", price: "$0", per: "per month", lead: "Every feature, for an AP team getting started.", items: ["100 checks a month", "Every feature included", "Unlimited mailboxes"] },
  { key: "pro", name: "Probity Plus", price: "$49", per: "per company, per month", lead: "For a team that pays vendors every week.", items: ["1,000 checks a month", "Everything in Free", "Cancel any time from Settings"] },
] as const;

const ROWS: Array<[string, string, string]> = [
  ["Checks a month", "100", "1,000"],
  ["Mailboxes (Gmail, Outlook)", "Unlimited", "Unlimited"],
  ["Hidden-text and AI-instruction detection", "✓", "✓"],
  ["Registry and web corroboration", "✓", "✓"],
  ["Xero sync and Slack verdicts", "✓", "✓"],
  ["Re-check before every payment run", "✓", "✓"],
];

const FAQ: Array<[string, string]> = [
  ["What counts as a check?", "One request run through the whole check. Opening a finished check or logging a call is free. A full re-check before a payment run, made when a registry fact has changed, counts as one."],
  ["What happens at the limit?", "New requests still arrive and wait in your inbox, marked not checked yet. Nothing is deleted. Checks resume next month, or straight away on Probity Plus."],
  ["Who handles payment?", "Dodo Payments is the merchant of record. Prices are in US dollars; tax is calculated at checkout. Cancel and Plus stays active until the end of the month you paid for."],
];

/** In-app pricing: the two plans with the workspace's current plan marked. Upgrades go through Settings. */
export function Plans() {
  const me = useData(() => account.me(), []);
  const own = !!me.data?.user && !me.data.org.isDemo;
  const billing = useData<Billing | null>(() => (own ? account.billing() : Promise.resolve(null)), [own]);
  const current = billing.data?.plan ?? (me.data && own ? me.data.org.plan : null);

  return (
    <div className="wrap ia">
      <header className="ia-head">
        <div>
          <p className="label" style={{ margin: 0 }}>Pricing</p>
          <h1 className="serif">Same check on both plans. Only the volume changes.</h1>
        </div>
      </header>
      <Status me={me.data} billing={billing.data} loading={me.loading || (own && billing.loading)} />

      <div className="ia-plans">
        {PLANS.map((p) => {
          const isCurrent = current === p.key;
          return (
            <div key={p.key} className={`card ia-plan${isCurrent ? " current" : ""}`}>
              <div className="between" style={{ flexWrap: "wrap" }}>
                <span className="label" style={{ color: "var(--fg)" }}>{p.name}</span>
                {isCurrent ? <span className="chip approve">Current plan</span> : p.key === "pro" && <span className="chip">For weekly payment runs</span>}
              </div>
              <div className="ia-price"><b>{p.price}</b><span>{p.per}</span></div>
              <p className="muted" style={{ margin: 0, fontSize: 14 }}>{p.lead}</p>
              <ul>{p.items.map((i) => <li key={i}><span aria-hidden="true">✓</span>{i}</li>)}</ul>
              <Cta plan={p.key} current={current} me={me.data} />
            </div>
          );
        })}
      </div>

      <div className="ia-lower">
        <div className="card" style={{ overflowX: "auto" }}>
          <table className="ia-cmp">
            <thead><tr><th>Compare</th><th className={current === "free" ? "on" : undefined}>Free</th><th className={current === "pro" ? "on" : undefined}>Plus</th></tr></thead>
            <tbody>
              {ROWS.map(([f, a, b]) => (
                <tr key={f}>
                  <td>{f}</td>
                  <td className={`${a === "✓" ? "yes" : "num"}${current === "free" ? " on" : ""}`}>{a}</td>
                  <td className={`${b === "✓" ? "yes" : "num"}${current === "pro" ? " on" : ""}`}>{b}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="ia-faq">
          <p className="label" style={{ margin: "0 0 8px" }}>Questions</p>
          {FAQ.map(([q, a]) => (
            <details key={q}><summary>{q}<span aria-hidden="true">+</span></summary><p>{a}</p></details>
          ))}
        </div>
      </div>
    </div>
  );
}

function Status({ me, billing, loading }: { me: Me | null; billing: Billing | null; loading: boolean }) {
  if (loading && !billing) return <Skeleton h={64} r={10} />;
  if (!me?.user || me.org.isDemo) {
    return (
      <div className="card pad between" style={{ flexWrap: "wrap" }}>
        <span>{me?.user ? "The demo company is shared. Plans belong to your own workspace." : "Start free; no card needed."}</span>
        <Link className="btn primary" href={me?.user ? "/app/onboarding" : "/signin"}>{me?.user ? "Create your workspace" : "Start free"}</Link>
      </div>
    );
  }
  if (!billing) return null;
  const { checksUsed, checksPerMonth } = billing.limits;
  const used = Math.min(1, checksPerMonth ? checksUsed / checksPerMonth : 0);
  return (
    <div className="card pad ia-usage">
      <div>
        <p className="label" style={{ margin: 0 }}>{me.org.name}</p>
        <b style={{ fontWeight: 500 }}>{billing.plan === "pro" ? "Probity Plus" : "Free"}</b>
      </div>
      <div style={{ display: "grid", gap: 6 }}>
        <div className="between" style={{ fontSize: 13.5 }}>
          <span className="muted">Checks this month</span>
          <span className="mono num">{checksUsed} of {checksPerMonth.toLocaleString("en-US")}</span>
        </div>
        <div className="ia-bar"><div style={{ width: `${used * 100}%`, background: used > 0.9 ? "var(--hold)" : undefined }} /></div>
      </div>
      <Link className="btn" href={BILLING}>Plan and billing</Link>
    </div>
  );
}

function Cta({ plan, current, me }: { plan: "free" | "pro"; current: string | null; me: Me | null }) {
  if (current === plan) return <Link className="btn" href={BILLING} style={{ justifySelf: "start" }}>Manage plan</Link>;
  if (!me?.user) return <Link className={`btn${plan === "pro" ? " primary" : ""}`} href={plan === "pro" ? "/signin?plan=plus" : "/signin"} style={{ justifySelf: "start" }}>{plan === "pro" ? "Start with Plus" : "Start free"}</Link>;
  if (plan === "pro") return <Link className="btn primary" href={BILLING} style={{ justifySelf: "start" }}>Upgrade to Plus</Link>;
  return <span className="muted" style={{ fontSize: 13.5 }}>Switch any time from Plan and billing.</span>;
}
