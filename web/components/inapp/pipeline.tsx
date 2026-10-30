import "./inapp.css";

type Lane = "code" | "model" | "both";
type Who = { name: string; model: boolean };
type Step = { n: string; title: string; lane: Lane; who: Who[]; body: string; tags?: string[]; verdicts?: boolean };

const CODE: Who = { name: "Code", model: false };
const ULTRA: Who = { name: "Nemotron 3 Ultra", model: true };
const VL: Who = { name: "Nemotron 3.5 Super VL", model: true };
const LIGHTNING: Who = { name: "Nemotron 3.5 Lightning", model: true };
const TAVILY: Who = { name: "Tavily", model: false };

const STEPS: Step[] = [
  { n: "01", title: "Open the PDF", lane: "code", who: [CODE], body: "Pulls the text layer with each line's size, position and colour, and renders every page to an image. Hidden text is caught here." },
  { n: "02", title: "Read it twice", lane: "model", who: [ULTRA, VL], body: "Ultra reads the text layer. Super VL reads each page image on its own. Text the picture doesn't show is flagged." },
  { n: "03", title: "Screen every line", lane: "model", who: [LIGHTNING], body: "Every line of the letter, the e-mail and each web page, screened for instructions aimed at an AI reviewer. Flagged lines become evidence." },
  { n: "04", title: "Find the vendor", lane: "model", who: [LIGHTNING, TAVILY], body: "Lightning plans the registry lookups by tool call, for a number to call that didn't come from the letter.", tags: ["SEC EDGAR", "USAspending", "GLEIF", "Vendor master", "Tavily"] },
  { n: "05", title: "Compare", lane: "model", who: [ULTRA], body: "Links each claim in the letter to the evidence and names every conflict." },
  { n: "06", title: "Decide", lane: "both", who: [CODE, LIGHTNING], body: "Policy is code. Lightning writes the reason; code checks every number in it against the evidence.", verdicts: true },
];

/** The six steps of a check, laid out as one pipeline with who runs each step. */
export function Pipeline() {
  return (
    <section aria-label="The six steps of a check" style={{ display: "grid", gap: 10 }}>
      <div className="ia-legend">
        <span><i />Code</span>
        <span><i className="model" />NVIDIA Nemotron on Nebius Token Factory</span>
        <b className="ia-rule">No model can approve a payment.</b>
      </div>
      <ol className="ia-pipe">
        {STEPS.map((s, i) => (
          <li key={s.n} className="ia-step">
            <div className={`ia-lane ${s.lane}`} aria-hidden="true" />
            <div className="ia-num"><span>{s.n}</span>{i < STEPS.length - 1 && <span className="ia-arrow" aria-hidden="true">→</span>}</div>
            <div style={{ display: "grid", gap: 8 }}>
              <h3>{s.title}</h3>
              <div className="ia-who">{s.who.map((w) => <span key={w.name} className={w.model ? "model" : undefined}>{w.name}</span>)}</div>
              <p>{s.body}</p>
            </div>
            {s.tags && <div className="ia-tags">{s.tags.map((t) => <span key={t}>{t}</span>)}</div>}
            {s.verdicts && (
              <div className="ia-verdicts">
                <span className="chip approve">Approve</span>
                <span className="chip callback">Call back</span>
                <span className="chip hold">Hold</span>
              </div>
            )}
          </li>
        ))}
      </ol>
    </section>
  );
}

const FLOW = [
  { t: "Payment run cut-off", d: "Each company sets its runs" },
  { t: "Refresh registry facts", d: "A full check again where anything changed" },
  { t: "NVIDIA NeMo Guardrails", d: "On a Nebius AI Cloud serverless job", hl: true },
  { t: "Summary out", d: "Slack and e-mail" },
];

/** The pre-run re-check, drawn as the four things that happen before every payment run. */
export function BeforeRun() {
  return (
    <div className="card pad ia-run">
      <div>
        <p className="label" style={{ margin: 0 }}>Before every payment run</p>
        <p style={{ margin: "6px 0 0", fontSize: 15.5 }}>Every open request is checked again before the money moves.</p>
      </div>
      <ol className="ia-flow">
        {FLOW.map((f) => (
          <li key={f.t} className={f.hl ? "hl" : undefined}><b>{f.t}</b><span>{f.d}</span></li>
        ))}
      </ol>
      <p className="muted" style={{ margin: 0, fontSize: 13.5 }}>
        The rails screen every line of every letter, e-mail and web page, and test each written reason against its evidence. The job posts signed results back; nothing runs between checks, so nothing bills by the hour.
      </p>
    </div>
  );
}
