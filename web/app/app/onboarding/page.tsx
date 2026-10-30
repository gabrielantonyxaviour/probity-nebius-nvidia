"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { account, ApiFailure } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { Connections } from "@/components/settings/connections";
import { PlanStep } from "@/components/plan-step";
import { Skeleton } from "@/components/states";
import { FormField, Input } from "@/components/ui/input";

export default function OnboardingPage() {
  return <Suspense><Onboarding /></Suspense>;
}

function Onboarding() {
  const router = useRouter();
  const params = useSearchParams();
  const me = useData(() => account.me(), []);
  const [name, setName] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!me.data) return <div className="wrap stack" style={{ paddingTop: 40, maxWidth: 720 }}><Skeleton h={40} w="50%" /><Skeleton h={160} /></div>;
  const m = me.data;
  if (!m.user) { router.replace("/signin"); return null; }
  const needsWorkspace = m.org.isDemo || params.get("new") === "1";
  const choosingPlan = !needsWorkspace && params.get("step") === "plan";
  const preferPlus = params.get("plan") === "plus";

  async function create(e: React.FormEvent) {
    e.preventDefault();
    if (name.trim().length < 2) return setError("Enter your company's name.");
    setBusy(true); setError(null);
    try {
      await account.createWorkspace(name.trim());
      router.replace(`/app/onboarding?step=plan${preferPlus ? "&plan=plus" : ""}`);
      me.reload();
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "Couldn't create the workspace. Try again.");
    } finally { setBusy(false); }
  }

  return (
    <div className="wrap" style={{ paddingTop: 34, maxWidth: 760 }}>
      <Steps at={needsWorkspace ? 1 : choosingPlan ? 2 : 3} />
      {needsWorkspace ? (
        <>
          <h1 className="serif" style={{ fontSize: "clamp(28px, 4vw, 38px)", margin: "14px 0 8px" }}>What&apos;s your company called?</h1>
          <p className="muted" style={{ margin: "0 0 20px" }}>Each company gets its own workspace: its mailbox, vendors, checks and team, kept apart from everyone else&apos;s.</p>
          <form onSubmit={create} className="card" style={{ padding: 20, display: "grid", gap: 14, maxWidth: 520 }}>
            <FormField label="Company name" htmlFor="ws-name">
              <Input id="ws-name" autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Acme Logistics Inc." maxLength={120} autoComplete="organization" />
            </FormField>
            {error && <p role="alert" style={{ margin: 0, color: "var(--hold)" }}>{error}</p>}
            <button className="btn primary" disabled={busy}>{busy ? "Creating…" : "Create workspace"}</button>
          </form>
        </>
      ) : choosingPlan ? (
        <>
          <h1 className="serif" style={{ fontSize: "clamp(28px, 4vw, 38px)", margin: "14px 0 8px" }}>Choose how you start.</h1>
          <p className="muted" style={{ margin: "0 0 22px" }}>Both plans run the same check with every feature. Plus is for teams that check more than 100 requests a month.</p>
          <PlanStep preferPlus={preferPlus} onDone={() => router.replace("/app/onboarding?step=connect")} />
        </>
      ) : (
        <>
          <h1 className="serif" style={{ fontSize: "clamp(28px, 4vw, 38px)", margin: "14px 0 8px" }}>Connect where your bank-change requests arrive.</h1>
          <p className="muted" style={{ margin: "0 0 22px" }}>
            Connect a mailbox and Probity checks every vendor bank-change e-mail as it arrives. Add Xero for your real vendor list and Slack for the verdicts. You can change any of this later in Settings.
          </p>
          <Connections canEdit={m.org.role === "owner" || m.org.role === "admin"} compact />
          <div className="row" style={{ gap: 12, marginTop: 26, flexWrap: "wrap" }}>
            <Link href="/app/settings?tab=runs" className="btn">Next: your payment-run schedule</Link>
            <Link href="/app" className="btn primary">Go to your inbox</Link>
          </div>
        </>
      )}
    </div>
  );
}

function Steps({ at }: { at: number }) {
  const steps = ["Your company", "Your plan", "Connect accounts"];
  return (
    <ol className="row" style={{ listStyle: "none", padding: 0, margin: 0, gap: 8, flexWrap: "wrap" }}>
      {steps.map((s, i) => (
        <li key={s} className="row" style={{ gap: 6, fontSize: 13, color: i + 1 <= at ? "var(--fg)" : "var(--muted)" }}>
          <span className="mono" style={{ width: 20, height: 20, borderRadius: "50%", display: "grid", placeItems: "center", fontSize: 11,
            background: i + 1 < at ? "var(--fg)" : "transparent", color: i + 1 < at ? "var(--bg)" : undefined, border: "1px solid currentColor" }}>{i + 1 < at ? "✓" : i + 1}</span>
          {s}{i < steps.length - 1 && <span className="muted" aria-hidden="true"> ——</span>}
        </li>
      ))}
    </ol>
  );
}
