import Link from "next/link";
import { LogoWall } from "@/components/landing/brands";
import { StartLink } from "@/components/landing/chrome";
import { MoneyField } from "@/components/landing/money-field";
import { Catches, Connect, Cta, Measured, Problem, ShowsItsWork } from "@/components/landing/sections";
import { Story } from "@/components/landing/story";


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
              <StartLink className="lp-pill solid" />
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

      <LogoWall />

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
