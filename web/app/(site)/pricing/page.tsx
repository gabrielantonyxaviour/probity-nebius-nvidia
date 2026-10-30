import Link from "next/link";

export const metadata = { title: "Pricing · Probity" };

const PLANS = [
  {
    name: "Free", price: "$0", per: "for as long as you like", cta: "Start free", href: "/signin", featured: false,
    lead: "Every feature, for an AP team getting started.",
    items: ["100 checks a month", "Gmail and Outlook, as many mailboxes as you need", "Xero vendor list, bank details and open bills", "Slack verdicts with buttons to log the call", "A re-check before every payment run", "The full evidence trail for every check"],
  },
  {
    name: "Probity Plus", price: "$49", per: "per company, per month", cta: "Start with Plus", href: "/signin?plan=plus", featured: true,
    lead: "For a team that pays vendors every week.",
    items: ["1,000 checks a month", "Everything in Free", "Billed monthly in US dollars", "Cancel any time from Settings"],
  },
];

const ROWS: Array<[string, string, string]> = [
  ["Checks a month", "100", "1,000"],
  ["Mailboxes (Gmail, Outlook)", "Unlimited", "Unlimited"],
  ["Upload any letter", "✓", "✓"],
  ["Hidden-text and AI-instruction detection", "✓", "✓"],
  ["Registry and web corroboration", "✓", "✓"],
  ["Xero sync before every run", "✓", "✓"],
  ["Slack verdicts and call logging", "✓", "✓"],
  ["Pre-run re-checks on your schedule", "✓", "✓"],
  ["Hold alerts and pre-run summaries by e-mail", "✓", "✓"],
];

const FAQ: Array<[string, string]> = [
  ["What counts as a check?", "One request run through the whole check: reading the letter, screening every line, the registry and web lookups, and the decision. Opening a finished check or logging a call is free. A full re-check before a payment run, made when a registry fact has changed, counts as one."],
  ["What happens when I reach the limit?", "New requests still arrive and wait in your inbox, marked not checked yet. Nothing is deleted. Checks resume at the start of the next month, or straight away on Probity Plus."],
  ["How do I choose a plan?", "Create your account and your company's workspace first. The last step of setup asks you to pick Free or Probity Plus; you can change your mind later under Settings, Plan and billing."],
  ["Judging the Nebius × NVIDIA hackathon?", "Enter the code NEBIUSJUDGES at the plan step, or under Settings, Plan and billing, for Probity Plus at no charge."],
  ["Who handles payment?", "Dodo Payments is the merchant of record. Prices are in US dollars; tax is calculated at checkout. Cancel and Plus stays active until the end of the month you paid for."],
];

export default function PricingPage() {
  return (
    <>
      <section className="lp-sec" style={{ paddingBottom: 48 }}>
        <div className="lp-frame lp-rv">
          <p className="lp-eyebrow lp-mono">Pricing</p>
          <h1 className="lp-h2" style={{ fontSize: "clamp(44px, 6vw, 84px)", maxWidth: "14ch" }}>Start free. Upgrade when your team runs on it.</h1>
          <p className="lp-body">Both plans run the same check: NVIDIA Nemotron on Nebius Token Factory, live registries, and a verdict made by code, never by a model. The only difference is how many checks a month.</p>
        </div>
      </section>

      <section className="lp-frame">
        <div className="pr-plans lp-rv">
          {PLANS.map((p) => (
            <div key={p.name} className={`pr-plan${p.featured ? " featured" : ""}`}>
              <div className="pr-top">
                <span className="lp-mono">{p.name}</span>
                {p.featured && <span className="lp-tag lp-mono">For weekly payment runs</span>}
              </div>
              <div className="pr-price"><span className="lp-serif">{p.price}</span><span className="lp-muted">{p.per}</span></div>
              <p className="lp-muted" style={{ margin: 0 }}>{p.lead}</p>
              <ul>{p.items.map((i) => <li key={i}><span aria-hidden="true">✓</span>{i}</li>)}</ul>
              <Link href={p.href} className={`lp-pill lp-mono${p.featured ? " solid" : ""}`} style={{ justifySelf: "start" }}>{p.cta} <span className="arr">→</span></Link>
            </div>
          ))}
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-frame">
          <p className="lp-eyebrow lp-mono lp-rv">Compare</p>
          <div className="lp-rv" style={{ overflowX: "auto" }}>
            <table className="pr-table">
              <thead><tr><th /><th className="lp-mono">Free</th><th className="lp-mono">Probity Plus</th></tr></thead>
              <tbody>{ROWS.map(([f, a, b]) => <tr key={f}><td>{f}</td><td>{a}</td><td>{b}</td></tr>)}</tbody>
            </table>
          </div>
        </div>
      </section>

      <section className="lp-sec lp-rule">
        <div className="lp-frame lp-two">
          <div className="lp-rv"><p className="lp-eyebrow lp-mono">Questions</p><h2 className="lp-h2">Plainly answered.</h2></div>
          <div className="lp-rv">
            {FAQ.map(([q, a]) => (
              <details key={q} className="pr-faq">
                <summary>{q}<span aria-hidden="true">+</span></summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      <style>{CSS}</style>
    </>
  );
}

const CSS = `
.pr-plans { display: grid; grid-template-columns: 1fr 1fr; border: 1px solid var(--l-rule); }
.pr-plan { padding: clamp(24px, 3vw, 40px); display: grid; gap: 18px; align-content: start; position: relative; }
.pr-plan + .pr-plan { border-left: 1px solid var(--l-rule); }
.pr-plan.featured { background: linear-gradient(180deg, #ebe8e20a, transparent 60%); box-shadow: inset 0 0 0 1px var(--l-cream); }
.pr-top { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; }
.pr-price { display: flex; align-items: baseline; gap: 12px; flex-wrap: wrap; }
.pr-price .lp-serif { font-size: clamp(64px, 7vw, 96px); line-height: .9; letter-spacing: -.03em; }
.pr-plan ul { list-style: none; margin: 0; padding: 0; display: grid; gap: 0; border-top: 1px dashed var(--l-rule); }
.pr-plan li { display: flex; gap: 12px; padding: 12px 0; border-bottom: 1px dashed var(--l-rule); }
.pr-plan li span { color: var(--l-ok); }
.pr-table { width: 100%; border-collapse: collapse; min-width: 560px; }
.pr-table th { text-align: left; color: var(--l-muted); font-weight: 400; padding: 14px 16px; border-bottom: 1px solid var(--l-rule); }
.pr-table td { padding: 14px 16px; border-bottom: 1px dashed var(--l-rule); color: #cfcbc3; }
.pr-table td:first-child { color: var(--l-fg); }
.pr-table td:not(:first-child), .pr-table th:not(:first-child) { width: 22%; }
.pr-faq { border-top: 1px solid var(--l-rule); }
.pr-faq:last-child { border-bottom: 1px solid var(--l-rule); }
.pr-faq summary { list-style: none; cursor: pointer; display: flex; justify-content: space-between; gap: 16px; padding: 22px 0; font-size: 19px; }
.pr-faq summary::-webkit-details-marker { display: none; }
.pr-faq summary span { color: var(--l-muted); transition: transform .23s var(--l-ease); font-family: var(--ff-mono), monospace; }
.pr-faq[open] summary span { transform: rotate(45deg); }
.pr-faq p { margin: 0 0 22px; color: var(--l-muted); max-width: 60ch; }
@media (max-width: 760px) { .pr-plans { grid-template-columns: 1fr; } .pr-plan + .pr-plan { border-left: 0; border-top: 1px solid var(--l-rule); } }
`;
