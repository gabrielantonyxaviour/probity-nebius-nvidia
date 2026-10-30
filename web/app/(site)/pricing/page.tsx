import Link from "next/link";

const PLANS = [
  {
    name: "Free", price: "$0", per: "", cta: "Start free", href: "/signin", featured: false,
    lead: "For a clerk who wants a second pair of eyes.",
    items: ["25 checks a month", "One mailbox: Gmail or Outlook", "Upload any letter", "Hidden-text and AI-instruction detection", "Registry and web corroboration", "The full evidence trail for every check"],
  },
  {
    name: "Pro", price: "$49", per: "per company, per month", cta: "Start free, upgrade in Settings", href: "/signin", featured: true,
    lead: "For an AP team that pays vendors every week.",
    items: ["500 checks a month", "Gmail and Outlook, as many mailboxes as you need", "Xero: your real vendor list, bank details and open bills", "Slack verdicts with call-back buttons", "A re-check before every payment run, on your schedule", "Hold alerts and pre-run summaries by e-mail"],
  },
  {
    name: "Enterprise", price: "Let's talk", per: "", cta: "Contact us", href: "mailto:gabrielantony56@gmail.com?subject=Probity%20Enterprise", featured: false,
    lead: "For shared-service centres and multiple entities.",
    items: ["Unlimited checks", "NetSuite, SAP and other accounting systems", "Your own sign-in (SSO) and audit export", "A custom payment policy", "Dedicated support"],
  },
];

export default function PricingPage() {
  return (
    <div className="wrap" style={{ paddingTop: 34 }}>
      <header style={{ maxWidth: 720 }}>
        <p className="label" style={{ margin: 0 }}>Pricing</p>
        <h1 className="serif" style={{ fontSize: "clamp(30px, 4.4vw, 46px)", lineHeight: 1.1, margin: "10px 0 12px" }}>One stopped diversion pays for years of Probity.</h1>
        <p className="muted" style={{ margin: 0, fontSize: 16 }}>Every plan runs the same check: NVIDIA Nemotron models on Nebius Token Factory, live registries, and a verdict made by code, never by a model.</p>
      </header>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 16, marginTop: 28, alignItems: "stretch" }}>
        {PLANS.map((p) => (
          <section key={p.name} className="card" style={{ padding: "22px 22px", display: "grid", gap: 14, alignContent: "start",
            borderColor: p.featured ? "var(--fg)" : undefined, boxShadow: p.featured ? "0 10px 30px rgba(0,0,0,.08)" : undefined }}>
            <div className="between">
              <b style={{ fontSize: 18, fontWeight: 600 }}>{p.name}</b>
              {p.featured && <span className="chip info">Most teams</span>}
            </div>
            <div>
              <span className="serif" style={{ fontSize: 40, lineHeight: 1 }}>{p.price}</span>
              {p.per && <span className="muted" style={{ marginLeft: 8, fontSize: 14 }}>{p.per}</span>}
            </div>
            <p className="muted" style={{ margin: 0 }}>{p.lead}</p>
            <ul style={{ margin: 0, paddingLeft: 0, listStyle: "none", display: "grid", gap: 8 }}>
              {p.items.map((i) => <li key={i} className="row" style={{ alignItems: "baseline", gap: 8, fontSize: 14.5 }}><span aria-hidden="true" style={{ color: "var(--approve)" }}>✓</span>{i}</li>)}
            </ul>
            <Link href={p.href} className={`btn ${p.featured ? "primary" : ""}`} style={{ marginTop: 4 }}>{p.cta}</Link>
          </section>
        ))}
      </div>
      <p className="muted" style={{ fontSize: 13, marginTop: 18 }}>Payments by Dodo Payments, merchant of record. Prices in USD; taxes calculated at checkout. Cancel any time from Settings.</p>
    </div>
  );
}
