import Link from "next/link";
import { MoneyField } from "@/components/landing/money-field";
import { Catches, Connect, Cta, Measured, Problem, ShowsItsWork } from "@/components/landing/sections";
import { Story } from "@/components/landing/story";

const WORKS = ["Gmail", "Outlook", "Xero", "Slack", "NVIDIA Nemotron", "Nebius Token Factory", "NVIDIA NeMo Guardrails", "Tavily", "SEC EDGAR", "GLEIF"];

export default function LandingPage() {
  return (
    <>
      <section className="lp-hero">
        <div className="lp-frame lp-hero-grid">
          <div>
            <h1>Before the money moves, prove who is asking.</h1>
            <p className="lp-lede">
              Probity checks every vendor bank-change request before the payment run.{" "}
              <em>It finds a number to call that didn&apos;t come from the request, catches lines no person can see, and tells your team to approve, call back or hold.</em>
            </p>
            <div className="lp-ctas lp-mono">
              <Link href="/signin" className="lp-pill solid">Start free <span className="arr">→</span></Link>
              <Link href="/#how" className="lp-pill">See how it works</Link>
            </div>
          </div>
          <Link href="/how" className="lp-link lp-mono"><span className="dot" />Runs on NVIDIA Nemotron · Nebius <span>→</span></Link>
        </div>
        <div className="lp-field">
          <MoneyField />
          <span className="lp-field-tag lp-mono">✕ Held: new account, unverified</span>
        </div>
      </section>

      <section aria-label="Works with" className="lp-frame" style={{ paddingTop: 0 }}>
        <div className="lp-works">
          {WORKS.slice(0, 4).map((w) => <span key={w}>{w}</span>)}
          <span className="center lp-mono">Works where your <b>AP team</b> already works</span>
          {WORKS.slice(4).map((w) => <span key={w}>{w}</span>)}
        </div>
      </section>

      <Problem />
      <section className="lp-sec" style={{ paddingBottom: 0 }}>
        <div className="lp-frame lp-rv" style={{ paddingBottom: 48 }}>
          <p className="lp-eyebrow lp-mono">How a check runs</p>
          <h2 className="lp-h2">Five steps, a few seconds each, before anyone touches the payment.</h2>
        </div>
        <div className="lp-frame"><Story /></div>
      </section>
      <Catches />
      <ShowsItsWork />
      <Connect />
      <Measured />
      <Cta />
    </>
  );
}
