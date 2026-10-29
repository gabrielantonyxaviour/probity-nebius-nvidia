"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import type { Me } from "@probity/shared";
import { account } from "@/lib/api";

/** Shown in the demo company only: what this is, and the way to your own workspace. */
export function DemoBanner() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { account.me().then(setMe).catch(() => setMe(null)); }, []);
  if (!me?.org.isDemo) return null;
  return (
    <div className="card" style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: "8px 14px", padding: "10px 16px", marginBottom: 18, background: "var(--synth-bg)", borderColor: "transparent" }}>
      <span className="chip synth">Demo company</span>
      <span style={{ flex: 1, minWidth: 220, fontSize: 14 }}>
        Halvorsen Mission Systems and its vendors are synthetic. Registry facts, web results and every model call are live.
      </span>
      <Link href={me.user ? "/onboarding" : "/signin"} className="btn primary" style={{ minHeight: 34, fontSize: 14 }}>
        {me.user ? "Set up your company" : "Connect your own mailbox"}
      </Link>
    </div>
  );
}
