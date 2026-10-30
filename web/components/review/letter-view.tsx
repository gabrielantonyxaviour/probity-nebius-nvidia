"use client";
import { useEffect, useState } from "react";
import type { HiddenText, Run } from "@probity/shared";
import { fileUrl } from "@/lib/api";

const WHY: Record<HiddenText["why"], string> = {
  white_on_white: "White text on a white page",
  tiny_glyphs: "Text too small to see",
  off_page: "Placed outside the page",
  under_image: "Hidden under an image",
  not_in_page_image: "In the text layer, but not on the page",
};
const FIELD: Record<string, string> = {
  legal_name: "Name", remit_address: "Remit address", bank_name: "Bank", routing_number: "Routing number",
  account_number: "Account", phone: "Phone", email: "E-mail", effective_date: "Effective", signatory: "Signed by", other: "Other",
};

/** `letterKey` is the stored letter; a request that came in as a plain e-mail has no page image, so its text is shown instead. */
export function LetterView({ run, letterKey }: { run: Run; letterKey?: string }) {
  const letter = run.letter;
  const [reveal, setReveal] = useState(true);
  const [page, setPage] = useState(0);
  if (!letter) return null;
  const imageless = letter.pageImages.length === 0;
  // "Not visible" compares each claim with a reading of the page image; checks since the vision model was withdrawn have none.
  const imageRead = letter.claims.some((c) => c.inImage);
  const hidden = letter.hidden.filter((h) => h.page === page);
  const [pw, ph] = letter.pageSize;

  return (
    <section className="card" aria-label="The letter">
      <div className="between" style={{ padding: "14px 18px", borderBottom: "1px solid var(--rule)", flexWrap: "wrap" }}>
        <div>
          <p className="label" style={{ margin: 0 }}>{imageless ? "The e-mail" : "The letter"}{!imageless && letter.pageCount > 1 ? ` · page ${page + 1} of ${letter.pageCount}` : ""}</p>
          {letter.hidden.length > 0 ? (
            <p style={{ margin: "4px 0 0", color: "var(--hold)", fontWeight: 500 }}>
              {letter.hidden.length} {letter.hidden.length === 1 ? "line" : "lines"} on this letter can&apos;t be seen by a person
            </p>
          ) : (
            <p className="muted" style={{ margin: "4px 0 0" }}>{imageless ? "The request is the e-mail's own text, as received. Nothing in it is hidden." : "Nothing hidden: the text layer matches the page."}</p>
          )}
        </div>
        {letter.hidden.length > 0 && (
          <div role="group" aria-label="View" className="row" style={{ gap: 0, border: "1px solid var(--rule-strong)", borderRadius: 8, overflow: "hidden" }}>
            <Seg on={!reveal} onClick={() => setReveal(false)}>What you see</Seg>
            <Seg on={reveal} onClick={() => setReveal(true)}>What an AI reads</Seg>
          </div>
        )}
      </div>

      <div className="letter-grid">
        <div style={{ padding: 16, background: "var(--surface-2)", minWidth: 0 }}>
          {imageless ? <LetterText fileKey={letterKey} /> : (
          <div style={{ position: "relative", maxWidth: 520, margin: "0 auto", boxShadow: "0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08)", background: "#fff" }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={fileUrl(letter.pageImages[page])} alt={`Page ${page + 1} of the letter as a person sees it`} style={{ display: "block", width: "100%", height: "auto" }} />
            {reveal && hidden.map((h, i) => h.bbox && (
              <div key={i} className="rise" title={h.text} style={{
                position: "absolute", left: `${(h.bbox[0] / pw) * 100}%`, top: `${(h.bbox[1] / ph) * 100}%`,
                width: `${((h.bbox[2] - h.bbox[0]) / pw) * 100}%`, minHeight: `${Math.max(((h.bbox[3] - h.bbox[1]) / ph) * 100, 1.6)}%`,
                background: "rgba(162, 53, 68, .14)", outline: "2px solid #a23544", borderRadius: 2,
              }}>
                <span aria-label={`Hidden line ${i + 1}`} style={{ position: "absolute", top: "50%", right: "calc(100% + 6px)", transform: "translateY(-50%)", width: 18, height: 18,
                  display: "grid", placeItems: "center", borderRadius: "50%", background: "#a23544", color: "#fff", fontSize: 11, fontWeight: 600 }}>
                  {i + 1}
                </span>
              </div>
            ))}
          </div>
          )}
          {!imageless && letter.pageCount > 1 && (
            <div className="row" style={{ justifyContent: "center", marginTop: 10 }}>
              {letter.pageImages.map((_, i) => <button key={i} className="btn" style={{ minHeight: 30, padding: "0 10px", background: i === page ? "var(--surface-3)" : undefined }} onClick={() => setPage(i)}>{i + 1}</button>)}
            </div>
          )}
        </div>

        <div style={{ padding: "16px 18px", display: "grid", gap: 14, alignContent: "start", minWidth: 0 }}>
          {reveal && letter.hidden.length > 0 && (
            <div style={{ display: "grid", gap: 10 }}>
              {letter.hidden.map((h, i) => (
                <div key={i} style={{ borderLeft: "3px solid var(--hold)", paddingLeft: 10 }}>
                  <p className="label" style={{ margin: 0, color: "var(--hold)" }}><span style={{ display: "inline-grid", placeItems: "center", width: 16, height: 16, borderRadius: "50%", background: "#a23544", color: "#fff", marginRight: 6, letterSpacing: 0 }}>{i + 1}</span>{WHY[h.why]}</p>
                  <p className="mono" style={{ margin: "4px 0 2px", fontSize: 12.5, overflowWrap: "anywhere" }}>&ldquo;{h.text}&rdquo;</p>
                  <p className="muted" style={{ margin: 0, fontSize: 12.5 }}>{h.detail}</p>
                </div>
              ))}
              <p className="muted" style={{ margin: 0, fontSize: 13 }}>
                Found in code from the PDF itself: text colour, size and position on the page. No agent ever follows text from a letter.
              </p>
            </div>
          )}
          <div>
            <p className="label" style={{ margin: "0 0 6px" }}>What the letter asks for</p>
            <dl style={{ margin: 0, display: "grid", gridTemplateColumns: "auto 1fr", gap: "6px 12px", fontSize: 14 }}>
              {letter.claims.map((c, i) => (
                <div key={i} style={{ display: "contents" }}>
                  <dt className="muted">{FIELD[c.field] ?? c.field}</dt>
                  <dd style={{ margin: 0, overflowWrap: "anywhere" }}>
                    {c.value}{" "}
                    {!c.inImage && imageRead && <span className="chip hold" title="Only in the text layer; the page image doesn't show it">not visible</span>}
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </div>
      </div>
      <style>{`.letter-grid { display: grid; grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); } @media (max-width: 1100px) { .letter-grid { grid-template-columns: 1fr; } }`}</style>
    </section>
  );
}

function Seg({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button aria-pressed={on} onClick={onClick} style={{ border: 0, padding: "7px 12px", fontSize: 13, cursor: "pointer",
      background: on ? "var(--primary)" : "var(--surface)", color: on ? "var(--primary-fg)" : "var(--fg-2)" }}>
      {children}
    </button>
  );
}

function LetterText({ fileKey }: { fileKey?: string }) {
  const isText = !!fileKey && /\.txt$/i.test(fileKey);
  const [text, setText] = useState<string | null>(null);
  useEffect(() => {
    if (!isText || !fileKey) return;
    let alive = true;
    fetch(fileUrl(fileKey), { credentials: "same-origin" })
      .then((r) => (r.ok ? r.text() : null)).then((t) => { if (alive) setText(t); }).catch(() => undefined);
    return () => { alive = false; };
  }, [fileKey, isText]);
  return (
    <div aria-label="The e-mail as received" style={{ maxWidth: 520, margin: "0 auto", padding: "22px 24px", background: "#fff", color: "#1d1d1b", fontSize: 13.5, lineHeight: 1.55,
      whiteSpace: "pre-wrap", overflowWrap: "anywhere", maxHeight: 560, overflowY: "auto", boxShadow: "0 1px 3px rgba(0,0,0,.12), 0 8px 24px rgba(0,0,0,.08)" }}>
      {text ?? <span style={{ color: "#76746d" }}>{isText ? "Loading the e-mail…" : "This letter has no page image to show."}</span>}
    </div>
  );
}
