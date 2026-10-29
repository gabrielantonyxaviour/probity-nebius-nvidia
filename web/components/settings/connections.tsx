"use client";
import { useState } from "react";
import type { Connection, Provider } from "@probity/shared";
import { account, ApiFailure } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { ErrorBox, Skeleton } from "../states";

const INFO: Record<Provider, { name: string; group: "mail" | "books" | "team"; what: string; mark: string }> = {
  gmail: { name: "Gmail", group: "mail", mark: "M", what: "Every new vendor e-mail asking to change bank or remittance details is checked within minutes. Other mail is ignored and never stored." },
  outlook: { name: "Outlook", group: "mail", mark: "O", what: "The same for Microsoft 365 and Outlook mailboxes." },
  xero: { name: "Xero", group: "books", mark: "X", what: "Your real vendor list and the bank details on file, plus open bills, so Probity knows what's at risk in the next run. Holds add a note to the vendor in Xero." },
  slack: { name: "Slack", group: "team", mark: "#", what: "Each verdict lands in your AP channel with the number to call and buttons to log the call. Holds alert the controller." },
};
const GROUPS = [
  { key: "mail", title: "Where requests arrive", note: "Connect one mailbox or several." },
  { key: "books", title: "Your accounting system", note: "Gives the vendor master and the money at risk." },
  { key: "team", title: "Where your team works", note: "Verdicts and pre-run summaries." },
] as const;

export function Connections({ canEdit, compact = false }: { canEdit: boolean; compact?: boolean }) {
  const list = useData(() => account.connections(), []);
  const [busy, setBusy] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const byProvider = new Map((list.data ?? []).map((c) => [c.provider, c]));

  async function connect(p: Provider) {
    setBusy(p); setError(null);
    try {
      const { redirectUrl } = await account.connect(p);
      window.location.assign(redirectUrl);
    } catch (e) {
      setError(e instanceof ApiFailure ? e.message : `Couldn't start the ${INFO[p].name} connection.`);
      setBusy(null);
    }
  }
  async function disconnect(p: Provider) {
    if (!window.confirm(`Disconnect ${INFO[p].name}? Probity stops reading it immediately.`)) return;
    setBusy(p); setError(null);
    try { await account.disconnect(p); list.reload(); }
    catch (e) { setError(e instanceof ApiFailure ? e.message : "Couldn't disconnect. Try again."); }
    finally { setBusy(null); }
  }

  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  return (
    <div style={{ display: "grid", gap: compact ? 14 : 22 }}>
      {error && <p role="alert" style={{ margin: 0, color: "var(--hold)" }}>{error}</p>}
      {GROUPS.map((g) => (
        <section key={g.key}>
          <div className="between" style={{ marginBottom: 8, flexWrap: "wrap" }}>
            <p className="label" style={{ margin: 0 }}>{g.title}</p>
            <span className="muted" style={{ fontSize: 13 }}>{g.note}</span>
          </div>
          <div style={{ display: "grid", gap: 10 }}>
            {(Object.keys(INFO) as Provider[]).filter((p) => INFO[p].group === g.key).map((p) =>
              list.loading && !list.data ? <Skeleton key={p} h={74} r={10} /> : (
                <Row key={p} p={p} c={byProvider.get(p)} busy={busy === p} canEdit={canEdit} onConnect={connect} onDisconnect={disconnect} compact={compact} />
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function Row({ p, c, busy, canEdit, onConnect, onDisconnect, compact }: {
  p: Provider; c?: Connection; busy: boolean; canEdit: boolean; compact: boolean;
  onConnect: (p: Provider) => void; onDisconnect: (p: Provider) => void;
}) {
  const info = INFO[p];
  const status = c?.status ?? "not_connected";
  return (
    <div className="card" style={{ display: "grid", gridTemplateColumns: "40px 1fr auto", gap: 14, alignItems: "center", padding: "14px 16px" }}>
      <span aria-hidden="true" className="serif" style={{ width: 40, height: 40, borderRadius: 10, display: "grid", placeItems: "center", background: "var(--surface-2)", fontSize: 20 }}>{info.mark}</span>
      <div style={{ minWidth: 0 }}>
        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
          <b style={{ fontWeight: 500 }}>{info.name}</b>
          {status === "connected" && <span className="chip approve">Connected</span>}
          {status === "pending" && <span className="chip callback">Finishing…</span>}
          {status === "error" && <span className="chip hold">Needs attention</span>}
        </div>
        <p className="muted" style={{ margin: "3px 0 0", fontSize: 13.5, overflowWrap: "anywhere" }}>
          {status === "connected" ? <>{c?.account}{c?.detail ? ` · ${c.detail}` : ""}</> : status === "error" ? c?.detail ?? "The connection stopped working. Reconnect it." : compact ? null : info.what}
        </p>
      </div>
      {canEdit && (status === "connected" ? (
        <button className="btn" onClick={() => onDisconnect(p)} disabled={busy} style={{ minHeight: 36 }}>{busy ? "…" : "Disconnect"}</button>
      ) : (
        <button className="btn primary" onClick={() => onConnect(p)} disabled={busy} style={{ minHeight: 36 }}>{busy ? "Opening…" : status === "error" ? "Reconnect" : "Connect"}</button>
      ))}
    </div>
  );
}
