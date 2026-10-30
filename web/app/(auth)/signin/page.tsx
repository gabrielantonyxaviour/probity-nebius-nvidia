"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Mark } from "@/components/landing/chrome";
import { MoneyField } from "@/components/landing/money-field";
import { account, ApiFailure } from "@/lib/api";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [digits, setDigits] = useState<string[]>(Array(6).fill(""));
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState<string | null>(null);
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  const code = digits.join("");
  const [checking, setChecking] = useState(true);

  // Already signed in: skip the form and go where this visit was heading.
  useEffect(() => {
    account.me().then((me) => { if (me.user) go(me.org.isDemo); else setChecking(false); }).catch(() => setChecking(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function go(needsWorkspace: boolean) {
    const q = new URLSearchParams(window.location.search);
    const next = q.get("next");
    const safe = next && /^\/app(\/[A-Za-z0-9/_?=&.-]*)?$/.test(next) ? next : null;
    const plus = q.get("plan") === "plus";
    router.replace(needsWorkspace ? `/app/onboarding${plus ? "?plan=plus" : ""}` : plus ? "/app/settings?tab=billing" : safe ?? "/app");
  }

  async function send(e?: React.FormEvent) {
    e?.preventDefault();
    if (!EMAIL.test(email.trim())) return setError("Enter a work e-mail address.");
    setBusy(true); setError(null);
    try {
      await account.sendCode(email.trim().toLowerCase());
      setStep("code"); setDigits(Array(6).fill("")); setSent(new Date().toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }));
      requestAnimationFrame(() => boxes.current[0]?.focus());
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "Couldn't send the code. Try again.");
    } finally { setBusy(false); }
  }

  async function verify(e?: React.FormEvent) {
    e?.preventDefault();
    if (!/^\d{6}$/.test(code)) return setError("Enter the 6-digit code from the e-mail.");
    setBusy(true); setError(null);
    try {
      await account.signIn(email.trim().toLowerCase(), code);
      const me = await account.me();
      go(me.org.isDemo); // back to the page that sent them here (only paths inside the app), else onboarding for a new account
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiFailure && err.status === 401 ? "That code didn't match or has expired. Check the e-mail or send a new one." : "Couldn't sign you in. Try again.");
      setBusy(false);
    }
  }

  function type(i: number, v: string) {
    const clean = v.replace(/\D/g, "");
    if (clean.length > 1) { // pasted or autofilled the whole code
      const next = clean.slice(0, 6).split("");
      setDigits([...next, ...Array(6 - next.length).fill("")]);
      boxes.current[Math.min(5, next.length)]?.focus();
      return;
    }
    const next = [...digits]; next[i] = clean; setDigits(next);
    if (clean && i < 5) boxes.current[i + 1]?.focus();
  }

  return (
    <div className="au">
      <div className="au-form">
        <div className="au-top">
          <Link href="/" className="lp-brand" aria-label="Probity home"><Mark /><span>Probity</span></Link>
          <Link href="/" className="lp-mono au-back">← Back to site</Link>
        </div>

        <div className="au-body" style={{ visibility: checking ? "hidden" : undefined }}>
          <p className="lp-eyebrow lp-mono">{step === "email" ? "Sign in or create an account" : "Step 2 of 2"}</p>
          <h1 className="au-h1">{step === "email" ? "Welcome to Probity." : "Check your e-mail."}</h1>
          <p className="au-sub">
            {step === "email"
              ? "Enter your work e-mail and we'll send a 6-digit code. No password. New here? The same code creates your account."
              : <>We sent a code to <b>{email}</b>{sent ? ` at ${sent}` : ""}. It expires in 10 minutes.</>}
          </p>

          {step === "email" ? (
            <form onSubmit={send} className="au-fields" noValidate>
              <label htmlFor="au-email" className="au-label">Work e-mail</label>
              <input id="au-email" type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ap@yourcompany.com" className="au-input" />
              {error && <p role="alert" className="au-error">{error}</p>}
              <button className="au-submit lp-mono" disabled={busy}>{busy ? "Sending…" : <>Continue with e-mail <span className="arr">→</span></>}</button>
            </form>
          ) : (
            <form onSubmit={verify} className="au-fields" noValidate>
              <span className="au-label" id="au-code-label">6-digit code</span>
              <div className="au-otp" role="group" aria-labelledby="au-code-label">
                {digits.map((d, i) => (
                  <input key={i} ref={(el) => { boxes.current[i] = el; }} value={d} inputMode="numeric" autoComplete={i === 0 ? "one-time-code" : "off"} maxLength={6}
                    aria-label={`Digit ${i + 1}`} onChange={(e) => type(i, e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Backspace" && !digits[i] && i > 0) boxes.current[i - 1]?.focus(); }} />
                ))}
              </div>
              {error && <p role="alert" className="au-error">{error}</p>}
              <button className="au-submit lp-mono" disabled={busy || code.length < 6}>{busy ? "Signing in…" : <>Verify and continue <span className="arr">→</span></>}</button>
              <div className="au-row">
                <button type="button" className="au-link" onClick={() => { setStep("email"); setError(null); }}>Use a different e-mail</button>
                <button type="button" className="au-link" onClick={() => send()} disabled={busy}>Send a new code</button>
              </div>
            </form>
          )}

          <ul className="au-perks lp-mono">
            <li>Free plan · 100 checks a month</li>
            <li>Every feature · no card</li>
          </ul>
        </div>

        <p className="au-legal">By continuing you agree to the <Link href="/terms">Terms</Link> and <Link href="/privacy">Privacy policy</Link>.</p>
      </div>

      <aside className="au-art" aria-hidden="true">
        <div className="au-art-grid" />
        <div className="au-card">
          <div className="au-card-head lp-mono"><span>Probity&apos;s decision</span><span>GM-20261030-B11A68</span></div>
          <p className="au-card-hold">Hold</p>
          <p className="au-card-line">The e-mail came from gmail.com, which is not a domain on file for Sable Harbor Marine Logistics LLC.</p>
          <div className="au-card-call">
            <span className="lp-mono">Call them on</span>
            <b>(757) 555-0190</b>
            <s>(757) 555-0148 · the letter&apos;s number</s>
          </div>
          <div className="au-card-btns lp-mono"><span>Confirmed</span><span className="red">They didn&apos;t send it</span><span>No answer</span></div>
        </div>
        <blockquote className="au-quote">
          <p>Before the money moves, prove who is asking.</p>
          <span className="lp-mono">NVIDIA Nemotron on Nebius Token Factory · about two cents a check</span>
        </blockquote>
        <div className="au-field"><MoneyField /></div>
      </aside>
    </div>
  );
}
