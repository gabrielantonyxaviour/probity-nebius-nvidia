"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/api";

const MAX = 10 * 1024 * 1024;

export default function NewCheckPage() {
  const router = useRouter();
  const [pdf, setPdf] = useState<File | null>(null);
  const [eml, setEml] = useState<File | null>(null);
  const [vendor, setVendor] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const problem =
    !pdf ? "Add the letter as a PDF." :
    pdf.size > MAX ? "The PDF is over 10 MB." :
    !/\.pdf$/i.test(pdf.name) ? "The letter must be a PDF." :
    vendor.trim().length < 2 ? "Enter the vendor's name as it appears in your records." : null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (problem || !pdf) return setError(problem);
    setBusy(true);
    setError(null);
    const form = new FormData();
    form.set("pdf", pdf);
    if (eml) form.set("eml", eml);
    form.set("vendorName", vendor.trim());
    try {
      const { requestId } = await api.upload(form);
      router.push(`/app/r/${requestId}`);
    } catch (err) {
      setError(err instanceof ApiFailure ? err.message : "Upload failed. Try again.");
      setBusy(false);
    }
  }

  return (
    <div className="wrap" style={{ paddingTop: 28, maxWidth: 760 }}>
      <p className="label" style={{ margin: 0 }}>Check a letter</p>
      <h1 className="serif" style={{ fontSize: "clamp(28px, 4vw, 40px)", lineHeight: 1.1, margin: "8px 0 10px" }}>Drop in a bank-change letter.</h1>
      <p className="muted" style={{ margin: "0 0 22px", fontSize: 16 }}>
        Probity finds text a person can&apos;t see, screens every line for instructions aimed at an AI, and looks the vendor up in public registries and on its own website. A real US company name returns live registry facts.
      </p>

      <form onSubmit={submit} className="card" style={{ padding: 22, display: "grid", gap: 18 }}>
        <Field label="The letter (PDF, up to 10 MB)" hint={pdf ? `${pdf.name} · ${(pdf.size / 1024).toFixed(0)} KB` : "A PDF with a text layer. A scan without one goes to the clerk to read."}>
          <input type="file" accept="application/pdf,.pdf" required onChange={(e) => setPdf(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="The e-mail it came with (.eml, optional)" hint={eml ? eml.name : "Adds the sender's domain and the mail-server checks to the evidence."}>
          <input type="file" accept=".eml,message/rfc822" onChange={(e) => setEml(e.target.files?.[0] ?? null)} />
        </Field>
        <Field label="Vendor name in your records" hint="For example: Leidos, Inc.">
          <input type="text" value={vendor} onChange={(e) => setVendor(e.target.value)} maxLength={160} autoComplete="organization"
            style={{ minHeight: 42, padding: "0 12px", borderRadius: 8, border: "1px solid var(--rule-strong)", background: "var(--field)", color: "var(--fg)", font: "inherit" }} />
        </Field>
        {error && <p role="alert" style={{ margin: 0, color: "var(--hold)" }}>{error}</p>}
        <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
          <button className="btn primary" disabled={busy}>{busy ? "Uploading…" : "Check it"}</button>
          <span className="muted" style={{ fontSize: 13 }}>Counts as one of your three live checks. Files are kept only to show this check.</span>
        </div>
      </form>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint: string; children: React.ReactNode }) {
  return (
    <label style={{ display: "grid", gap: 6 }}>
      <span style={{ fontWeight: 500 }}>{label}</span>
      {children}
      <span className="muted" style={{ fontSize: 13 }}>{hint}</span>
    </label>
  );
}
