"use client";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { FileDrop } from "@/components/ui/file-drop";

const MAX = 10 * 1024 * 1024;
const EML_MAX = 10 * 1024 * 1024;

const STEPS: { title: string; body: string }[] = [
  { title: "Open the PDF", body: "Pull out every line of text, including any a person can't see." },
  { title: "Read it twice", body: "Once as the page looks, once as the text layer reads." },
  { title: "Screen every line", body: "Flag instructions aimed at an AI rather than at you." },
  { title: "Find the vendor", body: "Public registries and the vendor's own website." },
  { title: "Decide", body: "Approve, call back, or hold, with the evidence attached." },
];

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
    <div className="nc">
      <style>{CSS}</style>
      <section className="nc-main">
        <div className="nc-inner">
          <p className="label" style={{ margin: 0 }}>Check a letter</p>
          <h1 className="serif nc-h1">Drop in a bank-change letter.</h1>
          <p className="muted nc-lede">
            Probity finds text a person can&apos;t see, screens every line for instructions aimed at an AI, and looks the vendor up in public registries and on its own website.
          </p>

          <form onSubmit={submit} className="nc-form" noValidate>
            <FileDrop label="The letter" accept="application/pdf,.pdf" pattern={/\.pdf$/i} typeLabel="PDF" maxBytes={MAX}
              file={pdf} onFile={(f) => { setPdf(f); setError(null); }} disabled={busy}
              prompt="Drop the letter PDF here"
              hint="Needs a text layer. A scan without one goes to the clerk to read." />

            <FileDrop compact optional label="The e-mail it came with" accept=".eml,message/rfc822" pattern={/\.eml$/i}
              typeLabel=".eml" maxBytes={EML_MAX} file={eml} onFile={setEml} disabled={busy}
              prompt="Attach the .eml"
              hint="Adds the sender's domain and the mail-server checks to the evidence." />

            <label className="nc-field">
              <span className="nc-flabel">Vendor name in your records</span>
              <input type="text" className="field nc-input" value={vendor} onChange={(e) => { setVendor(e.target.value); setError(null); }}
                maxLength={160} autoComplete="organization" placeholder="For example: Leidos, Inc." disabled={busy} />
              <span className="muted nc-fhint">As it appears on your vendor master. A real US company returns live registry facts.</span>
            </label>

            {error && <p role="alert" className="nc-error">{error}</p>}

            <div className="nc-submit">
              <button className="btn primary nc-btn" disabled={busy}>
                {busy ? <><span className="nc-spin" aria-hidden />Uploading…</> : <>Check it <span aria-hidden>→</span></>}
              </button>
              <span className="muted nc-note">Uses one check from your plan. Files are kept only to show this check.</span>
            </div>
          </form>
        </div>
      </section>

      <aside className="nc-side" aria-label="What happens next">
        <div className="nc-sinner">
          <p className="label" style={{ margin: 0 }}>What happens next</p>
          <ol className="nc-steps">
            {STEPS.map((s, i) => (
              <li key={s.title}>
                <span className="nc-num mono">{String(i + 1).padStart(2, "0")}</span>
                <span className="nc-st"><b>{s.title}</b><span>{s.body}</span></span>
              </li>
            ))}
          </ol>
          <p className="muted nc-time">The result page opens as soon as the upload lands.</p>
        </div>
      </aside>
    </div>
  );
}

const CSS = `
.nc { display: grid; grid-template-columns: minmax(0, 1fr); min-height: 100dvh; }
.nc-main { display: flex; align-items: center; justify-content: center; padding: clamp(28px, 5vw, 64px) var(--gutter); min-width: 0; }
.nc-inner { width: 100%; max-width: 620px; }
.nc-h1 { font-size: clamp(30px, 4vw, 44px); line-height: 1.08; margin: 10px 0 12px; }
.nc-lede { margin: 0 0 28px; font-size: 16px; line-height: 1.55; max-width: 56ch; }
.nc-form { display: grid; gap: 22px; }
.nc-field { display: grid; gap: 8px; }
.nc-flabel { font-weight: 500; font-size: 15px; }
.nc-input { min-height: 48px; padding: 0 14px; border-radius: 10px; font-size: 15.5px; transition: border-color .15s, box-shadow .15s; }
.nc-input::placeholder { color: var(--muted); opacity: .8; }
.nc-input:hover { border-color: var(--ring); }
.nc-input:focus { outline: none; border-color: var(--ring); box-shadow: 0 0 0 3px color-mix(in srgb, var(--ring) 28%, transparent); }
.nc-fhint { font-size: 13px; }
.nc-error { margin: 0; padding: 10px 12px; border-radius: 8px; border: 1px solid var(--hold-border); background: var(--hold-bg); color: var(--hold); font-size: 14px; }
.nc-submit { display: flex; flex-wrap: wrap; align-items: center; gap: 12px 16px; padding-top: 4px; }
.nc-btn { min-height: 48px; padding: 0 26px; border-radius: 10px; font-size: 15.5px; }
.nc-note { font-size: 13px; flex: 1 1 220px; }
.nc-spin { width: 14px; height: 14px; border-radius: 50%; border: 2px solid currentColor; border-right-color: transparent; animation: nc-rot .7s linear infinite; }
@keyframes nc-rot { to { transform: rotate(360deg); } }
.nc-side { background: var(--surface-2); border-top: 1px solid var(--rule); padding: 36px var(--gutter); display: flex; align-items: center; }
.nc-sinner { width: 100%; max-width: 620px; margin: 0 auto; }
.nc-steps { list-style: none; margin: 18px 0 0; padding: 0; display: grid; }
.nc-steps li { display: grid; grid-template-columns: 34px minmax(0, 1fr); gap: 12px; padding: 14px 0; border-top: 1px solid var(--rule); position: relative; }
.nc-steps li:last-child { border-bottom: 1px solid var(--rule); }
.nc-num { font-size: 12px; color: var(--muted); padding-top: 3px; }
.nc-st { display: grid; gap: 3px; }
.nc-st b { font-weight: 500; font-size: 15px; }
.nc-st span { color: var(--fg-2); font-size: 13.5px; line-height: 1.45; }
.nc-time { margin: 18px 0 0; font-size: 13px; }
@media (min-width: 1100px) {
  .nc { grid-template-columns: minmax(0, 1fr) minmax(320px, 400px); }
  .nc-side { border-top: 0; border-left: 1px solid var(--rule); padding: 48px 40px; }
}
@media (prefers-reduced-motion: reduce) { .nc-spin { animation-duration: 2s; } }
`;
