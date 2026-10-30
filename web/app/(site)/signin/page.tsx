"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { account, ApiFailure } from "@/lib/api";

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInPage() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!EMAIL.test(email.trim())) return setError("Enter a work e-mail address.");
    setBusy(true); setError(null);
    try {
      await account.sendCode(email.trim().toLowerCase());
      setStep("code");
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "Couldn't send the code. Try again.");
    } finally { setBusy(false); }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!/^\d{6}$/.test(code.trim())) return setError("Enter the 6-digit code from the e-mail.");
    setBusy(true); setError(null);
    try {
      await account.signIn(email.trim().toLowerCase(), code.trim());
      const me = await account.me();
      router.replace(me.org.isDemo ? "/onboarding" : "/");
      router.refresh();
    } catch (err) {
      setError(err instanceof ApiFailure && err.status === 401 ? "That code didn't match or has expired. Check the e-mail or send a new one." : "Couldn't sign you in. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="wrap" style={{ paddingTop: 48, maxWidth: 460 }}>
      <p className="label" style={{ margin: 0 }}>Sign in or start free</p>
      <h1 className="serif" style={{ fontSize: 36, lineHeight: 1.1, margin: "8px 0 10px" }}>
        {step === "email" ? "Protect your next payment run." : "Check your e-mail."}
      </h1>
      <p className="muted" style={{ margin: "0 0 22px" }}>
        {step === "email"
          ? "We'll e-mail you a 6-digit code. No password. New here? The same code creates your account."
          : <>We sent a code to <b style={{ color: "var(--fg)" }}>{email}</b>. It expires in 10 minutes.</>}
      </p>
      {step === "email" ? (
        <form onSubmit={send} className="card" style={{ padding: 20, display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 500 }}>Work e-mail</span>
            <input type="email" autoComplete="email" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} placeholder="ap@yourcompany.com" className="field" />
          </label>
          {error && <p role="alert" style={{ margin: 0, color: "var(--hold)" }}>{error}</p>}
          <button className="btn primary" disabled={busy}>{busy ? "Sending…" : "Email me a code"}</button>
        </form>
      ) : (
        <form onSubmit={verify} className="card" style={{ padding: 20, display: "grid", gap: 14 }}>
          <label style={{ display: "grid", gap: 6 }}>
            <span style={{ fontWeight: 500 }}>6-digit code</span>
            <input inputMode="numeric" autoComplete="one-time-code" autoFocus maxLength={6} value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} className="field mono" style={{ fontSize: 22, letterSpacing: "0.3em" }} />
          </label>
          {error && <p role="alert" style={{ margin: 0, color: "var(--hold)" }}>{error}</p>}
          <button className="btn primary" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
          <button type="button" className="linkish" onClick={() => { setStep("email"); setCode(""); setError(null); }}>Use a different e-mail</button>
        </form>
      )}
      <p className="muted" style={{ fontSize: 13, marginTop: 16 }}>
        Just looking? The <a href="/">demo company</a> is open to everyone, no account needed.
      </p>
    </div>
  );
}
