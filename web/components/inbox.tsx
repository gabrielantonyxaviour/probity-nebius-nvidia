"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InboxItem } from "@probity/shared";
import { api } from "@/lib/api";
import { dateTime, money, moneyShort, until } from "@/lib/format";
import { useData } from "@/lib/use-data";
import { ErrorBox, Skeleton } from "./states";
import { DemoBanner } from "./demo-banner";
import { SweepCard } from "./sweep-card";
import { VerdictChip } from "./verdict";

const RANK = { HOLD: 0, CALLBACK_VERIFY: 1, null: 2, APPROVE: 3 } as const;
const SOURCE: Record<InboxItem["source"], string> = { seed: "", upload: "Uploaded · ", gmail: "Gmail · ", outlook: "Outlook · " };
const KIND = { bank_change: "New bank account", remit_change: "New remit address" };

export function Inbox() {
  const inbox = useData(() => api.inbox(), [], 8000, (d) => d.some((i) => i.status === "checking"));
  const sweep = useData(() => api.sweep(), []);
  const items = [...(inbox.data ?? [])].sort((a, b) => RANK[`${a.verdict}` as keyof typeof RANK] - RANK[`${b.verdict}` as keyof typeof RANK]);
  const cutoff = items.find((i) => i.nextRunAt)?.nextRunAt ?? null;
  const atRisk = items.filter((i) => i.verdict !== "APPROVE").reduce((s, i) => s + i.amountAtRisk.cents, 0);
  const held = items.filter((i) => i.verdict === "HOLD").length;
  const unchecked = items.filter((i) => !i.verdict).length;
  const hidden = items.find((i) => i.requestId === "BCR-2026-0407");

  return (
    <div className="wrap" style={{ paddingTop: 22 }}>
      <DemoBanner />
      <section style={{ display: "grid", gridTemplateColumns: "minmax(0, 1.6fr) minmax(0, 1fr)", gap: 20, alignItems: "end" }} className="hero">
        <div>
          <p className="label" style={{ margin: 0 }}>
            Payment run{cutoff && <> · cut-off {dateTime(cutoff)} · <span style={{ color: "var(--fg)" }}>{until(cutoff)} left</span></>}
          </p>
          <h1 className="serif" style={{ fontSize: "clamp(30px, 4.4vw, 46px)", lineHeight: 1.08, margin: "10px 0 12px" }}>
            {inbox.data ? `${items.length} vendors asked to change where we pay them.` : "Bank-change requests before the payment run."}
          </h1>
          <p className="muted" style={{ margin: 0, maxWidth: 620, fontSize: 16 }}>
            {inbox.data ? (
              <>
                <b style={{ color: "var(--fg)" }}>{moneyShort(atRisk)}</b> of this run would go to new details.{" "}
                {held > 0 && <><b style={{ color: "var(--hold)" }}>{held} on hold</b>. </>}
                {unchecked > 0 ? `${unchecked} not checked yet.` : "Every request has been checked."}
              </>
            ) : (
              "Probity checks each request against public registries and the web, and tells you to approve, call back or hold."
            )}
          </p>
        </div>
        <SweepCard sweep={sweep.data ?? null} compact />
      </section>

      {hidden && (
        <Link href={`/r/${hidden.requestId}`} className="card rise" style={{ display: "flex", gap: 14, alignItems: "center", marginTop: 22, padding: "14px 18px", textDecoration: "none", borderColor: "var(--info-border)", background: "var(--info-bg)" }}>
          <span className="chip info">Start here</span>
          <span style={{ flex: 1 }}>Sable Harbor&apos;s letter looks routine. It hides lines that only an AI would read.</span>
          <span aria-hidden="true">→</span>
        </Link>
      )}

      <section style={{ marginTop: 22 }} aria-label="Requests">
        {inbox.error && <ErrorBox error={inbox.error} onRetry={inbox.reload} />}
        {inbox.loading && !inbox.data && (
          <div className="card pad stack">{[0, 1, 2, 3].map((i) => <Skeleton key={i} h={44} />)}</div>
        )}
        {inbox.data && items.length === 0 && (
          <div className="card" style={{ padding: "30px 24px", display: "grid", gap: 10, justifyItems: "start" }}>
            <p className="serif" style={{ fontSize: 24, margin: 0 }}>No bank-change requests yet.</p>
            <p className="muted" style={{ margin: 0, maxWidth: 560 }}>Connect your AP mailbox and every vendor e-mail asking to change bank or remittance details is checked as it arrives. You can also check a letter by hand.</p>
            <div className="row" style={{ gap: 10, flexWrap: "wrap" }}>
              <Link href="/settings" className="btn primary">Connect a mailbox</Link>
              <Link href="/new" className="btn">Check a letter</Link>
            </div>
          </div>
        )}
        {items.length > 0 && <Table items={items} />}
      </section>
      <style>{`@media (max-width: 820px) { .hero { grid-template-columns: 1fr !important; } }`}</style>
    </div>
  );
}

function Table({ items }: { items: InboxItem[] }) {
  const router = useRouter();
  return (
    <div className="card">
      <div className="tablewrap inbox-table">
        <table className="t">
          <thead>
            <tr><th>Verdict</th><th>Vendor</th><th>Change</th><th style={{ textAlign: "right" }}>At risk</th><th>Received</th><th>Status</th></tr>
          </thead>
          <tbody>
            {items.map((i) => (
              <tr key={i.requestId} onClick={() => router.push(`/r/${i.requestId}`)} style={{ cursor: "pointer" }} className="inbox-row">
                <td><VerdictChip verdict={i.verdict} /></td>
                <td>
                  <Link href={`/r/${i.requestId}`} style={{ textDecoration: "none", fontWeight: 500 }}>{i.vendorName}</Link>
                  <div className="mono muted" style={{ fontSize: 12 }}>{SOURCE[i.source]}{i.requestId} · {i.senderEmail}</div>
                </td>
                <td>{KIND[i.kind]}</td>
                <td className="num" style={{ textAlign: "right", whiteSpace: "nowrap" }}>{money(i.amountAtRisk)}</td>
                <td className="muted" style={{ whiteSpace: "nowrap" }}>{dateTime(i.receivedAt)}</td>
                <td style={{ whiteSpace: "nowrap" }}><Status i={i} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="inbox-cards" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {items.map((i) => (
          <li key={i.requestId} style={{ borderTop: "1px solid var(--rule)" }}>
            <Link href={`/r/${i.requestId}`} style={{ display: "grid", gap: 6, padding: "14px 16px", textDecoration: "none" }}>
              <div className="between"><VerdictChip verdict={i.verdict} /><span className="num">{money(i.amountAtRisk)}</span></div>
              <b style={{ fontWeight: 500 }}>{i.vendorName}</b>
              <span className="muted" style={{ fontSize: 13 }}>{KIND[i.kind]} · <Status i={i} /></span>
            </Link>
          </li>
        ))}
      </ul>
      <style>{`
        .inbox-row:hover td { background: var(--surface-2); }
        .inbox-cards { display: none; }
        @media (max-width: 720px) { .inbox-table { display: none; } .inbox-cards { display: block; } .inbox-cards li:first-child { border-top: 0 !important; } }
      `}</style>
    </div>
  );
}

function Status({ i }: { i: InboxItem }) {
  if (i.status === "checking") return <span className="pulse">● Checking now</span>;
  if (i.outcome === "confirmed") return <span style={{ color: "var(--approve)" }}>Call: confirmed</span>;
  if (i.outcome === "denied") return <span style={{ color: "var(--hold)" }}>Call: vendor didn&apos;t send it</span>;
  if (i.outcome === "no_answer") return <span>Call: no answer yet</span>;
  if (i.verdict === "CALLBACK_VERIFY") return <span style={{ color: "var(--callback)" }}>Call needed</span>;
  if (!i.verdict) return <span className="muted">Waiting</span>;
  return <span className="muted">{i.sweptAt ? "Pre-checked overnight" : "Checked"}</span>;
}
