"use client";
import { useState } from "react";
import { VendorInput, type Vendor } from "@probity/shared";
import { ApiFailure, vendors } from "@/lib/api";

type Fields = { legalName: string; domains: string; phone: string; bankName: string; routing: string; account: string };
const EMPTY: Fields = { legalName: "", domains: "", phone: "", bankName: "", routing: "", account: "" };

/** Turns the form into a VendorInput; bank details are sent only when any of them is filled in. */
function toInput(f: Fields) {
  const bankGiven = [f.bankName, f.routing, f.account].some((x) => x.trim());
  return {
    legalName: f.legalName,
    domains: f.domains.split(/[\s,;]+/).map((d) => d.replace(/^.*@/, "").trim()).filter(Boolean),
    ...(f.phone.trim() ? { phone: f.phone } : {}),
    ...(bankGiven ? { bank: { bankName: f.bankName, routing: f.routing.replace(/\s/g, ""), account: f.account.replace(/\s/g, "") } } : {}),
  };
}

const FIELD_OF: Record<string, keyof Fields> = { legalName: "legalName", domains: "domains", phone: "phone", "bank.bankName": "bankName", "bank.routing": "routing", "bank.account": "account" };

export function VendorForm({ onCancel, onAdded }: { onCancel: () => void; onAdded: (v: Vendor) => void }) {
  const [f, setF] = useState<Fields>(EMPTY);
  const [errs, setErrs] = useState<Partial<Record<keyof Fields, string>>>({});
  const [failure, setFailure] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof Fields) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setFailure(null);
    const parsed = VendorInput.safeParse(toInput(f));
    if (!parsed.success) {
      const next: Partial<Record<keyof Fields, string>> = {};
      for (const i of parsed.error.issues) {
        const k = FIELD_OF[i.path.filter((p) => typeof p === "string").join(".")] ?? (i.path[0] === "domains" ? "domains" : i.path[0] === "bank" ? "bankName" : undefined);
        if (k && !next[k]) next[k] = i.message.startsWith("Expected") || i.message === "Required" ? "Fill this in." : i.message;
      }
      setErrs(next);
      return;
    }
    setErrs({});
    setBusy(true);
    try { onAdded(await vendors.add(parsed.data)); setF(EMPTY); }
    catch (err) { setFailure(err instanceof ApiFailure ? err.message : "Couldn't add the vendor. Try again."); }
    finally { setBusy(false); }
  }

  return (
    <form onSubmit={submit} className="card pad rise" noValidate style={{ display: "grid", gap: 14 }}>
      <p className="serif" style={{ fontSize: 22, margin: 0 }}>Add a vendor</p>
      <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))" }}>
        <Field label="Legal name" error={errs.legalName} wide>
          <input className="field" value={f.legalName} onChange={set("legalName")} placeholder="Halvorsen Freight Partners LLC" autoComplete="off" required />
        </Field>
        <Field label="E-mail domains they write from" hint="Separate with commas" error={errs.domains}>
          <input className="field" value={f.domains} onChange={set("domains")} placeholder="halvorsenfreight.com" autoComplete="off" />
        </Field>
        <Field label="Call-back number on file" hint="From a contract or your records, never from a request" error={errs.phone}>
          <input className="field" value={f.phone} onChange={set("phone")} placeholder="(206) 555-0134" inputMode="tel" autoComplete="off" />
        </Field>
      </div>
      <fieldset style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 12 }}>
        <legend className="label" style={{ marginBottom: 8 }}>The account you pay today (optional)</legend>
        <div style={{ display: "grid", gap: 12, gridTemplateColumns: "repeat(auto-fit, minmax(180px, 1fr))" }}>
          <Field label="Bank" error={errs.bankName}><input className="field" value={f.bankName} onChange={set("bankName")} placeholder="Puget Sound Federal" autoComplete="off" /></Field>
          <Field label="Routing number" error={errs.routing}><input className="field mono" value={f.routing} onChange={set("routing")} placeholder="9 digits" inputMode="numeric" autoComplete="off" /></Field>
          <Field label="Account number" hint="Probity keeps a fingerprint and the last 4 digits only" error={errs.account}><input className="field mono" value={f.account} onChange={set("account")} inputMode="numeric" autoComplete="off" /></Field>
        </div>
      </fieldset>
      {failure && <p role="alert" style={{ margin: 0, color: "var(--hold)" }}>{failure}</p>}
      <div className="row" style={{ gap: 8, justifyContent: "flex-end" }}>
        <button type="button" className="btn" onClick={onCancel}>Cancel</button>
        <button type="submit" className="btn primary" disabled={busy}>{busy ? "Adding…" : "Add vendor"}</button>
      </div>
    </form>
  );
}

function Field({ label, hint, error, wide = false, children }: { label: string; hint?: string; error?: string; wide?: boolean; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6, gridColumn: wide ? "1 / -1" : undefined }}>
      <span style={{ fontSize: 14, fontWeight: 500 }}>{label}{hint && <span className="muted" style={{ fontWeight: 400 }}> · {hint}</span>}</span>
      {children}
      {error && <span style={{ color: "var(--hold)", fontSize: 13 }}>{error}</span>}
    </label>
  );
}
