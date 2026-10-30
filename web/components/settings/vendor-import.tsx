"use client";
import { useState } from "react";
import type { ImportResult } from "@probity/shared";
import { ApiFailure, vendors } from "@/lib/api";
import { FileDrop, Textarea } from "../ui/input";

const HEADER = "name,domain,phone,bank_name,routing,account";
const EXAMPLE = `${HEADER}\nHalvorsen Freight Partners LLC,halvorsenfreight.com,(206) 555-0134,Puget Sound Federal,125000105,7730014521`;
const TEMPLATE = `data:text/csv;charset=utf-8,${encodeURIComponent(EXAMPLE + "\n")}`;
const MAX_BYTES = 200_000;

/** Paste or choose a CSV of vendors; rows that can't be added come back with the reason. */
export function VendorImport({ onCancel, onImported }: { onCancel: () => void; onImported: (added: number) => void }) {
  const [csv, setCsv] = useState("");
  const [file, setFile] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);

  async function choose(f: File) {
    if (f.size > MAX_BYTES) { setFailure("That file is over 200 KB. Split it into smaller files."); return; }
    setFailure(null); setResult(null); setFile(f.name); setCsv(await f.text());
  }

  async function submit() {
    setBusy(true); setFailure(null); setResult(null);
    try {
      const r = await vendors.importCsv(csv);
      setResult(r);
      if (r.added) onImported(r.added);
      if (r.skipped.length === 0) { setCsv(""); setFile(null); }
    } catch (e) { setFailure(e instanceof ApiFailure ? e.message : "Couldn't import the file. Try again."); }
    finally { setBusy(false); }
  }

  return (
    <div className="card pad rise" style={{ display: "grid", gap: 14 }}>
      <div className="between" style={{ flexWrap: "wrap" }}>
        <p className="serif" style={{ fontSize: 22, margin: 0 }}>Import vendors</p>
        <a className="linkish" href={TEMPLATE} download="probity-vendors.csv">Download the template</a>
      </div>
      <p className="muted" style={{ margin: 0, fontSize: 14 }}>
        One vendor per row, with the header <span className="mono">{HEADER}</span>. Only <span className="mono">name</span> is required. Up to 500 rows; vendors already in your list are skipped.
      </p>
      <FileDrop accept=".csv,text/csv" onFile={choose} fileName={file} prompt="Drop a CSV file here" detail={file ? "Loaded below. Edit before importing if you need to." : "Up to 200 KB, or paste the rows below"} />
      <Textarea mono value={csv} onChange={(e) => { setCsv(e.target.value); setFile(null); setResult(null); }} rows={6} spellCheck={false}
        placeholder={EXAMPLE} aria-label="CSV text" style={{ minHeight: 130 }} />
      {failure && <p role="alert" style={{ margin: 0, color: "var(--hold)" }}>{failure}</p>}
      {result && (
        <div role="status" style={{ display: "grid", gap: 6 }}>
          <p style={{ margin: 0, color: result.added ? "var(--approve)" : "var(--fg-2)" }}>
            {result.added ? `Added ${result.added} ${result.added === 1 ? "vendor" : "vendors"}.` : "No vendors were added."}
            {result.skipped.length > 0 && ` ${result.skipped.length} ${result.skipped.length === 1 ? "row was" : "rows were"} skipped:`}
          </p>
          {result.skipped.length > 0 && (
            <ul style={{ margin: 0, paddingLeft: 18, fontSize: 14, maxHeight: 160, overflowY: "auto" }}>
              {result.skipped.slice(0, 50).map((s) => <li key={s.row}><span className="mono">Row {s.row}</span>: {s.reason}</li>)}
            </ul>
          )}
        </div>
      )}
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button className="btn" onClick={onCancel}>Close</button>
        <button className="btn primary" onClick={submit} disabled={busy || !csv.trim()}>{busy ? "Importing…" : "Import"}</button>
      </div>
    </div>
  );
}
