"use client";
import { useMemo, useState } from "react";
import type { Vendor } from "@probity/shared";
import { ApiFailure, vendors } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { Empty, ErrorBox, Skeleton } from "../states";
import { VendorForm } from "./vendor-form";
import { VendorImport } from "./vendor-import";

type Panel = "add" | "import" | null;
const SOURCE: Record<Vendor["source"], { label: string; cls: string }> = {
  xero: { label: "Xero", cls: "chip info" },
  sample: { label: "Sample", cls: "chip synth" },
  manual: { label: "Added here", cls: "chip" },
};

/** The vendors of record. Every check compares a request against one of these. */
export function Vendors({ canEdit, onGoConnections }: { canEdit: boolean; onGoConnections: () => void }) {
  const list = useData(() => vendors.list(), []);
  const [panel, setPanel] = useState<Panel>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ ok: boolean; text: string } | null>(null);
  const [q, setQ] = useState("");

  const all = list.data ?? [];
  const shown = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? all.filter((v) => v.legalName.toLowerCase().includes(t) || v.domains.some((d) => d.includes(t))) : all;
  }, [all, q]);

  const done = (text: string) => { setNote({ ok: true, text }); setPanel(null); list.reload(); };
  const failed = (e: unknown, fallback: string) => setNote({ ok: false, text: e instanceof ApiFailure ? e.message : fallback });

  async function loadSamples() {
    setBusy("samples"); setNote(null);
    try {
      const r = await vendors.samples();
      done(r.added ? `Added ${r.added} sample vendors. Upload one of their letters from New check to see a full check.` : "The sample vendors are already in your list.");
    } catch (e) { failed(e, "Couldn't add the sample vendors. Try again."); }
    finally { setBusy(null); }
  }
  async function remove(v: Vendor) {
    if (!window.confirm(`Remove ${v.legalName}? Requests from them will no longer match a vendor of record.`)) return;
    setBusy(v.id); setNote(null);
    try { await vendors.remove(v.id); done(`Removed ${v.legalName}.`); }
    catch (e) { failed(e, "Couldn't remove that vendor. Try again."); }
    finally { setBusy(null); }
  }

  if (list.error) return <ErrorBox error={list.error} onRetry={list.reload} />;
  if (list.loading && !list.data) return <div className="stack"><Skeleton h={40} /><Skeleton h={220} r={10} /></div>;

  const hasSamples = all.some((v) => v.source === "sample");
  return (
    <div style={{ display: "grid", gap: 16 }}>
      <div className="between" style={{ flexWrap: "wrap", alignItems: "flex-end" }}>
        <div style={{ maxWidth: 560 }}>
          <p className="label" style={{ margin: 0 }}>Vendors of record · {all.length}</p>
          <p className="muted" style={{ margin: "4px 0 0", fontSize: 14 }}>
            Every request is checked against the vendor it claims to come from: the domains they write from, the number you call them on, and the account you pay today.
          </p>
        </div>
        {canEdit && (
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <button className={`btn${panel === "import" ? " primary" : ""}`} onClick={() => setPanel(panel === "import" ? null : "import")} style={{ minHeight: 36 }}>Import CSV</button>
            <button className={`btn${panel === "add" ? " primary" : ""}`} onClick={() => setPanel(panel === "add" ? null : "add")} style={{ minHeight: 36 }}>Add a vendor</button>
          </div>
        )}
      </div>

      {note && <p role="status" style={{ margin: 0, color: note.ok ? "var(--approve)" : "var(--hold)", fontSize: 14 }}>{note.text}</p>}
      {panel === "add" && <VendorForm onCancel={() => setPanel(null)} onAdded={(v) => done(`Added ${v.legalName}.`)} />}
      {panel === "import" && <VendorImport onCancel={() => setPanel(null)} onImported={(n) => { list.reload(); setNote({ ok: true, text: `Imported ${n} ${n === 1 ? "vendor" : "vendors"}.` }); }} />}

      {all.length === 0 ? (
        <Empty title="No vendors yet">
          <p style={{ margin: "0 auto 16px", maxWidth: 460 }}>Probity can only check a request against a vendor it knows. Bring your list in one of three ways.</p>
          {canEdit && (
            <div className="row" style={{ justifyContent: "center", flexWrap: "wrap", gap: 8 }}>
              <button className="btn primary" onClick={onGoConnections}>Connect Xero</button>
              <button className="btn" onClick={() => setPanel("import")}>Import a CSV</button>
              <button className="btn" onClick={loadSamples} disabled={busy === "samples"}>{busy === "samples" ? "Adding…" : "Try 35 sample vendors"}</button>
            </div>
          )}
        </Empty>
      ) : (
        <>
          {all.length > 8 && (
            <input className="field" type="search" placeholder="Find a vendor or domain" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Find a vendor" style={{ maxWidth: 360 }} />
          )}
          <div className="card tablewrap">
            <table className="t">
              <thead><tr><th>Vendor</th><th>Writes from</th><th>Call-back number</th><th>Pays into</th>{canEdit && <th aria-label="Actions" />}</tr></thead>
              <tbody>
                {shown.map((v) => (
                  <tr key={v.id}>
                    <td style={{ minWidth: 200 }}>
                      <div style={{ fontWeight: 500 }}>{v.legalName}</div>
                      <div className="row" style={{ gap: 6, marginTop: 4 }}>
                        <span className={SOURCE[v.source].cls}>{SOURCE[v.source].label}</span>
                        {v.status === "inactive" && <span className="chip">Inactive</span>}
                      </div>
                    </td>
                    <td className="mono" style={{ fontSize: 13 }}>{v.domains.length ? v.domains.join(", ") : <span className="muted">None on file</span>}</td>
                    <td className="num" style={{ whiteSpace: "nowrap" }}>{v.phone ?? <span className="muted">None on file</span>}</td>
                    <td style={{ whiteSpace: "nowrap" }}>{v.bank ? <>{v.bank.bankName} <span className="mono muted">••••{v.bank.last4}</span></> : <span className="muted">None on file</span>}</td>
                    {canEdit && (
                      <td style={{ textAlign: "right" }}>
                        {v.source !== "xero" && <button className="linkish" onClick={() => remove(v)} disabled={busy === v.id}>{busy === v.id ? "Removing…" : "Remove"}</button>}
                      </td>
                    )}
                  </tr>
                ))}
                {shown.length === 0 && <tr><td colSpan={5} className="muted">No vendor matches “{q}”.</td></tr>}
              </tbody>
            </table>
          </div>
          {canEdit && !hasSamples && all.every((v) => v.source !== "xero") && (
            <p className="muted" style={{ margin: 0, fontSize: 14 }}>
              Want to see Probity work before your real list is in?{" "}
              <button className="linkish" onClick={loadSamples} disabled={busy === "samples"}>{busy === "samples" ? "Adding…" : "Add 35 sample vendors"}</button>
            </p>
          )}
        </>
      )}
    </div>
  );
}
