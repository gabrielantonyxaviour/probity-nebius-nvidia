"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { account } from "@/lib/api";

/** The record on file and the letter, overlapping; the crimson overlap is where they must line up. */
export function Mark({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size * 0.77} viewBox="2 9 60 46" aria-hidden="true">
      <path d="M30 26h9v7a5 5 0 0 1-5 5H25V31a5 5 0 0 1 5-5z" fill="#E25D6E" />
      <rect x="7" y="14" width="32" height="24" rx="5" fill="none" stroke="currentColor" strokeWidth="4.5" />
      <rect x="25" y="26" width="32" height="24" rx="5" fill="none" stroke="currentColor" strokeWidth="4.5" />
    </svg>
  );
}

type Session = { state: "loading" | "in" | "out"; hasWorkspace: boolean };
let cached: Promise<Session> | null = null;
/** One /api/me call per page view, shared by every session-aware link on it. */
function loadSession(): Promise<Session> {
  cached ??= account.me().then((m) => ({ state: m.user ? "in" as const : "out" as const, hasWorkspace: !!m.user && !m.org.isDemo })).catch(() => ({ state: "out" as const, hasWorkspace: false }));
  return cached;
}
export function useSession(): Session {
  const [s, setS] = useState<Session>({ state: "loading", hasWorkspace: false });
  useEffect(() => { let alive = true; loadSession().then((v) => { if (alive) setS(v); }); return () => { alive = false; }; }, []);
  return s;
}

/** Where "get started" goes: signed out to sign-in; signed in to the app (or to finish setup, or to billing for Plus). */
export function startHref(s: Session, plan?: "plus"): string {
  if (s.state !== "in") return plan ? "/signin?plan=plus" : "/signin";
  if (!s.hasWorkspace) return plan ? "/app/onboarding?plan=plus" : "/app/onboarding";
  return plan ? "/app/settings?tab=billing" : "/app";
}

/** A call to action that knows the visitor's session: "Start free" when signed out, "Open Probity" when signed in. */
export function StartLink({ className, out = "Start free", signedIn = "Open Probity", plan, arrow = true }: { className?: string; out?: string; signedIn?: string; plan?: "plus"; arrow?: boolean }) {
  const s = useSession();
  return (
    <Link href={startHref(s, plan)} className={className}>
      {s.state === "in" ? signedIn : out}{arrow && <> <span className="arr">→</span></>}
    </Link>
  );
}

export function LandingHeader() {
  const signedIn = useSession().state === "in";
  return (
    <header className="lp-hdr">
      <div className="lp-frame">
        <Link href="/" className="lp-brand" aria-label="Probity home"><Mark /><span>Probity</span></Link>
        <nav className="lp-nav lp-mono" aria-label="Main">
          <Link href="/#how">Product</Link>
          <Link href="/how">How it works</Link>
          <Link href="/pricing">Pricing</Link>
          <a href="https://github.com/gabrielantonyxaviour/probity-nebius-nvidia" target="_blank" rel="noreferrer">GitHub</a>
        </nav>
        <div className="lp-hdr-right lp-mono">
          {signedIn ? (
            <StartLink className="lp-pill solid" />
          ) : (
            <>
              <Link href="/signin?next=/app" className="lp-pill hide-sm" style={{ borderColor: "transparent" }}>Sign in</Link>
              <StartLink className="lp-pill solid" />
            </>
          )}
        </div>
      </div>
    </header>
  );
}

const COLS: Array<[string, Array<[string, string]>]> = [
  ["Product", [["How it works", "/how"], ["Pricing", "/pricing"], ["Start free", "/signin"], ["Sign in", "/signin?next=/app"]]],
  ["Connects to", [["Gmail and Outlook", "/how"], ["Xero", "/how"], ["Slack", "/how"], ["Any PDF letter", "/how"]]],
  ["Built on", [["NVIDIA Nemotron", "/how"], ["Nebius Token Factory", "/how"], ["NVIDIA NeMo Guardrails", "/how"], ["Nebius AI Cloud", "/how"]]],
  ["Policies", [["Privacy", "/privacy"], ["Terms", "/terms"], ["MIT licence", "https://github.com/gabrielantonyxaviour/probity-nebius-nvidia/blob/main/LICENSE"], ["Source code", "https://github.com/gabrielantonyxaviour/probity-nebius-nvidia"]]],
];

export function LandingFooter() {
  return (
    <footer className="lp-foot">
      <div className="lp-frame">
        <div className="lp-foot-grid">
          <div style={{ display: "grid", gap: 14, alignContent: "start" }}>
            <Link href="/" className="lp-brand" aria-label="Probity home"><Mark /><span>Probity</span></Link>
            <p className="lp-muted" style={{ margin: 0, maxWidth: "34ch", fontSize: 14 }}>
              Checks every vendor bank-change request before the payment run, and tells your team to approve, call back or hold.
            </p>
          </div>
          {COLS.map(([h, links]) => (
            <div key={h}>
              <h4 className="lp-mono">{h}</h4>
              <ul>{links.map(([t, href]) => <li key={t}>{href.startsWith("/signin") ? <StartLink out={t} signedIn={t === "Sign in" ? "Open Probity" : "Go to your inbox"} arrow={false} /> : <a href={href} {...(href.startsWith("http") ? { target: "_blank", rel: "noreferrer" } : {})}>{t}</a>}</li>)}</ul>
            </div>
          ))}
        </div>
        <div className="lp-foot-note">
          <span>Probity&apos;s demo company, its vendors and its letters are synthetic. Your own mailbox, Xero, Slack, registry facts and web results are real.</span>
          <span className="lp-mono" style={{ fontSize: 11 }}>Built for the Nebius × NVIDIA hackathon, 2026</span>
        </div>
      </div>
    </footer>
  );
}

/** Adds .lp-js to the page and reveals .lp-rv blocks as they scroll in. Without JS everything is simply visible. */
export function Reveal() {
  useEffect(() => {
    const root = document.querySelector(".lp");
    if (!root || matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    root.classList.add("lp-js");
    const io = new IntersectionObserver((es) => es.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); io.unobserve(e.target); } }), { rootMargin: "0px 0px -8% 0px" });
    root.querySelectorAll(".lp-rv").forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, []);
  return null;
}
