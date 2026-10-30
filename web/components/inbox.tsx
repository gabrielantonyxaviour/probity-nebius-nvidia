"use client";
import Link from "next/link";
import { useState } from "react";
import type { InboxItem } from "@probity/shared";
import { api } from "@/lib/api";
import { dateTime, money, moneyShort, until } from "@/lib/format";
import { useData } from "@/lib/use-data";
import { ErrorBox, Skeleton } from "./states";
import { DemoBanner } from "./demo-banner";
import { SweepCard } from "./sweep-card";
import { VerdictChip } from "./verdict";
import "./inbox.css";

const RANK = { HOLD: 0, CALLBACK_VERIFY: 1, null: 2, APPROVE: 3 } as const;
const SOURCE: Record<InboxItem["source"], string> = { seed: "Example", upload: "Uploaded", gmail: "Gmail", outlook: "Outlook" };
const KIND = { bank_change: "New bank account", remit_change: "New remit address" };
type Filter = "all" | "HOLD" | "CALLBACK_VERIFY" | "APPROVE" | "open";

const ago = (iso: string): string => {
  const m = Math.round((Date.now() - Date.parse(iso)) / 60000);
  if (m < 1) return "just now";
  if (m < 60) return `${m} min ago`;
  if (m < 60 * 24) return `${Math.round(m / 60)} h ago`;
  return dateTime(iso);
};

export function Inbox() {
  const inbox = useData(() => api.inbox(), [], 8000, (d) => d.some((i) => i.status === "checking"));
  const sweep = useData(() => api.sweep(), []);
  const [filter, setFilter] = useState<Filter>("all");
  const [q, setQ] = useState("");
  const items = [...(inbox.data ?? [])].sort((a, b) => RANK[`${a.verdict}` as keyof typeof RANK] - RANK[`${b.verdict}` as keyof typeof RANK]);
  const cutoff = items.find((i) => i.nextRunAt)?.nextRunAt ?? null;
  const atRisk = items.filter((i) => i.verdict !== "APPROVE").reduce((s, i) => s + i.amountAtRisk.cents, 0);
  const count = (f: Filter) => items.filter((i) => match(i, f)).length;
  const shown = items.filter((i) => match(i, filter) && (!q.trim() || `${i.vendorName} ${i.requestId} ${i.senderEmail}`.toLowerCase().includes(q.trim().toLowerCase())));
  const starter = items.find((i) => i.requestId === "BCR-2026-0407");

  const STATS: Array<{ f: Filter; label: string; tone: string }> = [
    { f: "HOLD", label: "On hold", tone: "var(--hold)" },
    { f: "CALLBACK_VERIFY", label: "Call back", tone: "var(--callback)" },
    { f: "APPROVE", label: "Clear", tone: "var(--approve)" },
    { f: "open", label: "Not checked", tone: "var(--muted)" },
  ];

  return (
    <div className="ib">
      <DemoBanner />
      <header className="ib-head">
        <div>
          <p className="label" style={{ margin: 0 }}>Inbox</p>
          <h1 className="serif">Bank-change requests</h1>
        </div>
        <div className="ib-head-right">
          {cutoff && <span className="ib-run"><span className="ib-dot" />Next run cut-off <b>{dateTime(cutoff)}</b> · {until(cutoff)} left</span>}
          <Link href="/app/new" className="btn primary">Check a letter</Link>
        </div>
      </header>

      <section className="ib-stats" aria-label="This payment run">
        <button className={`ib-stat ib-risk${filter === "all" ? " on" : ""}`} onClick={() => setFilter("all")}>
          <span className="label">At risk this run</span>
          <b className="serif num">{inbox.data ? moneyShort(atRisk) : "—"}</b>
          <span className="muted">{items.length} {items.length === 1 ? "request" : "requests"}</span>
        </button>
        {STATS.map((s) => (
          <button key={s.f} className={`ib-stat${filter === s.f ? " on" : ""}`} onClick={() => setFilter(filter === s.f ? "all" : s.f)} aria-pressed={filter === s.f}>
            <span className="label"><i style={{ background: s.tone }} />{s.label}</span>
            <b className="serif num">{inbox.data ? count(s.f) : "—"}</b>
          </button>
        ))}
      </section>

      {starter && (
        <Link href={`/app/r/${starter.requestId}`} className="ib-starter">
          <span className="chip info">Start here</span>
          <span>Sable Harbor&apos;s letter looks routine. It hides lines only an AI would read.</span>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      <section className="ib-list card" aria-label="Requests">
        <div className="ib-toolbar">
          <span className="ib-title">{filter === "all" ? "All requests" : STATS.find((s) => s.f === filter)?.label}<span className="muted"> · {shown.length}</span></span>
          <input className="field ib-search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search vendor, request or sender" aria-label="Search requests" />
        </div>
        {inbox.error && <div style={{ padding: 16 }}><ErrorBox error={inbox.error} onRetry={inbox.reload} /></div>}
        {inbox.loading && !inbox.data && <div className="stack" style={{ padding: 16 }}>{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={52} />)}</div>}
        {inbox.data && items.length === 0 && (
          <div className="ib-empty">
            <p className="serif">No bank-change requests yet.</p>
            <p className="muted">Connect your AP mailbox and every vendor e-mail asking to change bank details is checked as it arrives.</p>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <Link href="/app/settings?tab=connections" className="btn primary">Connect a mailbox</Link>
              <Link href="/app/new" className="btn">Check a letter</Link>
            </div>
          </div>
        )}
        {inbox.data && items.length > 0 && shown.length === 0 && <p className="muted" style={{ padding: "28px 18px", margin: 0 }}>Nothing matches. Clear the filter or the search.</p>}
        <ul className="ib-rows">
          {shown.map((i) => (
            <li key={i.requestId}>
              <Link href={`/app/r/${i.requestId}`} className="ib-row">
                <span className="ib-verdict"><VerdictChip verdict={i.verdict} /></span>
                <span className="ib-vendor">
                  <b>{i.vendorName}</b>
                  <span className="mono muted">{SOURCE[i.source]} · {i.requestId}</span>
                </span>
                <span className="ib-kind muted">{KIND[i.kind]}</span>
                <span className="ib-amt num">{money(i.amountAtRisk)}</span>
                <span className="ib-when muted" title={dateTime(i.receivedAt)}>{ago(i.receivedAt)}</span>
                <span className="ib-status"><Status i={i} /></span>
                <span className="ib-chev" aria-hidden="true">›</span>
              </Link>
            </li>
          ))}
        </ul>
      </section>

      <div className="ib-sweep"><SweepCard sweep={sweep.data ?? null} compact /></div>
    </div>
  );
}

function match(i: InboxItem, f: Filter): boolean {
  if (f === "all") return true;
  if (f === "open") return !i.verdict;
  return i.verdict === f;
}

function Status({ i }: { i: InboxItem }) {
  if (i.status === "checking") return <span className="pulse">● Checking now</span>;
  if (i.outcome === "confirmed") return <span style={{ color: "var(--approve)" }}>Call: confirmed</span>;
  if (i.outcome === "denied") return <span style={{ color: "var(--hold)" }}>Call: not sent by vendor</span>;
  if (i.outcome === "no_answer") return <span>Call: no answer</span>;
  if (i.verdict === "CALLBACK_VERIFY") return <span style={{ color: "var(--callback)" }}>Call needed</span>;
  if (!i.verdict) return <span className="muted">Waiting</span>;
  return <span className="muted">{i.sweptAt ? "Re-checked" : "Checked"}</span>;
}
