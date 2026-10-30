"use client";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { account } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { BillingPanel } from "@/components/settings/billing-panel";
import { Connections } from "@/components/settings/connections";
import { ScheduleEditor } from "@/components/settings/schedule-editor";
import { Vendors } from "@/components/settings/vendors";
import { ErrorBox, Skeleton } from "@/components/states";

const TABS = [
  { key: "connections", label: "Connections" },
  { key: "vendors", label: "Vendors" },
  { key: "runs", label: "Payment runs" },
  { key: "billing", label: "Plan and billing" },
] as const;
type Tab = (typeof TABS)[number]["key"];
const billingDoneTab = (p: URLSearchParams): Tab | null => (p.get("billing") === "done" ? "billing" : null);
const NAMES: Record<string, string> = { gmail: "Gmail", outlook: "Outlook", xero: "Xero", slack: "Slack" };

export default function SettingsPage() {
  return <Suspense><Settings /></Suspense>;
}

function Settings() {
  const params = useSearchParams();
  const router = useRouter();
  const me = useData(() => account.me(), []);
  // The sidebar links straight to each tab, so the tab follows the URL.
  const asked = params.get("tab") as Tab | null;
  const tab: Tab = billingDoneTab(params) ?? (asked && TABS.some((t) => t.key === asked) ? asked : "connections");
  const connected = params.get("connected");
  const failed = params.get("error");
  const billingDone = params.get("billing") === "done";


  if (me.error) return <div className="wrap" style={{ paddingTop: 28 }}><ErrorBox error={me.error} onRetry={me.reload} /></div>;
  if (!me.data) return <div className="wrap stack" style={{ paddingTop: 28 }}><Skeleton h={40} w="40%" /><Skeleton h={200} /></div>;
  const m = me.data;
  if (!m.user || m.org.isDemo) {
    return (
      <div className="wrap" style={{ paddingTop: 40, maxWidth: 640 }}>
        <h1 className="serif" style={{ fontSize: 34, margin: "0 0 10px" }}>Settings belong to your own company.</h1>
        <p className="muted" style={{ margin: "0 0 18px" }}>The demo company is shared and read-only. Create a workspace to connect your mailbox, your accounting system and Slack.</p>
        <Link href={m.user ? "/app/onboarding" : "/signin"} className="btn primary">{m.user ? "Create your workspace" : "Start free"}</Link>
      </div>
    );
  }
  const canEdit = m.org.role === "owner" || m.org.role === "admin";
  const pick = (t: Tab) => router.replace(`/app/settings?tab=${t}`, { scroll: false });

  return (
    <div className="wrap" style={{ paddingTop: 26, maxWidth: 980 }}>
      <p className="label" style={{ margin: 0 }}>{m.org.name}</p>
      <h1 className="serif" style={{ fontSize: "clamp(28px, 4vw, 38px)", margin: "6px 0 18px" }}>{TABS.find((t) => t.key === tab)?.label}</h1>
      {connected && <Notice ok>{NAMES[connected] ?? connected} is connected.</Notice>}
      {failed && <Notice>{NAMES[failed] ?? "The"} connection didn&apos;t finish. Try again.</Notice>}
      {billingDone && <Notice ok>Thanks. Your plan updates as soon as the payment is confirmed, usually within a minute.</Notice>}
      {tab === "connections" && <Connections canEdit={canEdit} />}
      {tab === "vendors" && <Vendors canEdit={canEdit} onGoConnections={() => pick("connections")} />}
      {tab === "runs" && <ScheduleEditor canEdit={canEdit} />}
      {tab === "billing" && <BillingPanel canEdit={canEdit} />}
      {!canEdit && <p className="muted" style={{ marginTop: 18, fontSize: 14 }}>Only owners and admins can change these settings.</p>}
    </div>
  );
}

function Notice({ ok = false, children }: { ok?: boolean; children: React.ReactNode }) {
  return (
    <p role="status" className="card" style={{ margin: "0 0 16px", padding: "10px 14px", background: ok ? "var(--approve-bg)" : "var(--hold-bg)", borderColor: ok ? "var(--approve-border)" : "var(--hold-border)", color: ok ? "var(--approve)" : "var(--hold)" }}>
      {children}
    </p>
  );
}
