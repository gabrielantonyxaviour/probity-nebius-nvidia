import { LiveNumbers } from "@/components/live-numbers";

const PIPELINE = [
  { n: "1", title: "Open the PDF", who: "Code", body: "Pulls the text layer with each line's size, position and colour, and renders every page to an image. White-on-white, 1-point and off-page text are caught here, in code." },
  { n: "2", title: "Read it twice", who: "Nemotron 3 Ultra · Nemotron 3.5 Super VL", body: "Ultra, with reasoning on, reads the text layer for what the letter asks: the new account, the routing number, who signed, and any push to hurry. Super VL reads the picture of each page on its own. Lines the code hid from view are withheld, so they can't steer either reading, and anything in the text that the picture doesn't show is flagged." },
  { n: "3", title: "Screen every line", who: "Nemotron 3.5 Lightning", body: "Every line of the letter, the e-mail and every web page is screened for instructions aimed at an AI reviewer. Flagged lines become evidence, never instructions." },
  { n: "4", title: "Find the vendor", who: "Nemotron 3.5 Lightning · Tavily", body: "Lightning plans the lookups by tool call: SEC EDGAR, USAspending, GLEIF, our vendor records, and the vendor's own website through Tavily, for a number to call that didn't come from the letter." },
  { n: "5", title: "Compare", who: "Nemotron 3 Ultra", body: "Ultra, with reasoning on, links each claim in the letter to the evidence and names every conflict." },
  { n: "6", title: "Decide", who: "Code · Nemotron 3.5 Lightning", body: "The payment policy is code: approve, call back or hold. Lightning writes the reason up, and code checks every number in it against the evidence." },
];

const LIMITS = [
  "The buying company, its vendor records, ledger and every letter are synthetic. Letters that use a real company's name are fabricated and say so inside the document.",
  "Registries cover US companies. A private vendor has no public phone number, so the number to call comes from our own records, never from the letter.",
  "Web lookups share a small free budget. Results are cached, and each visitor gets three new lookups.",
  "Live checks are capped per day and per visitor so the demo stays up through judging. Recorded checks are free to open.",
  "If Token Factory stops serving the vision model (it was briefly unavailable on 30 October), the page-image reading is skipped and the check carries on with the text layer and the PDF checks. A scan with no text layer then goes to the clerk to read.",
  "The pre-run re-check runs a full check again only when a registry fact has changed; otherwise it screens and re-checks the reasoning.",
];

export default function HowPage() {
  return (
    <div className="wrap" style={{ paddingTop: 28, display: "grid", gap: 36 }}>
      <header style={{ maxWidth: 820 }}>
        <p className="label" style={{ margin: 0 }}>How it works</p>
        <h1 className="serif" style={{ fontSize: "clamp(30px, 4.4vw, 46px)", lineHeight: 1.1, margin: "10px 0 12px" }}>
          Two readings, three NVIDIA Nemotron models, and one rule: no model can approve a payment.
        </h1>
        <p className="muted" style={{ margin: 0, fontSize: 16 }}>
          A bank-change letter is the cheapest way to steal a payment run. Policy says to call the vendor back on a number that didn&apos;t come from the request. Probity finds that number, checks everything else, and tells the clerk what to do before the cut-off.
        </p>
      </header>

      <section aria-label="The check">
        <p className="label" style={{ margin: "0 0 12px" }}>One check, live on Nebius Token Factory</p>
        <ol style={{ listStyle: "none", margin: 0, padding: 0, display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))", gap: 14 }}>
          {PIPELINE.map((s) => (
            <li key={s.n} className="card pad" style={{ display: "grid", gap: 6, alignContent: "start" }}>
              <span className="mono muted" style={{ fontSize: 12 }}>{s.n}</span>
              <b style={{ fontSize: 17, fontWeight: 500 }}>{s.title}</b>
              <span className="chip" style={{ justifySelf: "start", textTransform: "none", letterSpacing: 0, fontSize: 11.5 }}>{s.who}</span>
              <span className="muted" style={{ fontSize: 14 }}>{s.body}</span>
            </li>
          ))}
        </ol>
      </section>

      <section style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(300px, 1fr))", gap: 18, alignItems: "start" }}>
        <div className="card pad" style={{ display: "grid", gap: 8 }}>
          <p className="label" style={{ margin: 0 }}>Before every payment run</p>
          <p style={{ margin: 0, fontSize: 16 }}>
            Each company sets its payment runs and cut-offs. Before each one, Probity checks every open request again: registry facts are refreshed, a full check runs again where anything changed, and the <b>NVIDIA NeMo Guardrails</b> rails screen every line of every letter, e-mail and web page and test each written reason against its evidence. The summary goes to Slack and by e-mail.
          </p>
          <p className="muted" style={{ margin: 0, fontSize: 14 }}>
            On schedule, the rails run inside the app on Nemotron 3.5 Lightning through Token Factory, from the same rail definitions. The full NeMo Guardrails library runs on a <b>Nebius AI Cloud Serverless Job</b>, started from the command line for the measured evaluation and bulk re-screens; it posts signed results back, and its job id shows here. Nothing runs between checks, so nothing bills by the hour.
          </p>
        </div>
        <LiveNumbers />
      </section>

      <section>
        <p className="label" style={{ margin: "0 0 12px" }}>Works where your team already works</p>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))", gap: 14 }}>
          {[
            ["Gmail and Outlook", "Connect the AP mailbox. Every vendor e-mail asking to change bank or remittance details is checked within minutes; other mail is ignored and never stored. Connected through Composio."],
            ["Xero", "Your real vendor list with the bank details on file, and open bills, so the money at risk is exact. A hold adds a note to the vendor in Xero."],
            ["Slack", "Each verdict lands in your AP channel with the number to call and buttons to log the call. Holds alert the controller."],
            ["Upload", "Any letter, any time, from the web."],
          ].map(([t, d]) => (
            <div key={t} className="card pad" style={{ display: "grid", gap: 6, alignContent: "start" }}>
              <b style={{ fontWeight: 500 }}>{t}</b>
              <span className="muted" style={{ fontSize: 14 }}>{d}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="card pad" style={{ display: "grid", gap: 8 }}>
        <p className="label" style={{ margin: 0 }}>A fine-tuned Nemotron screen, measured</p>
        <p style={{ margin: 0 }}>
          We LoRA-tuned NVIDIA Llama-3.1-Nemotron-Nano-4B on 1,406 letters written by Nemotron 3.5 Lightning, in one Nebius AI Cloud Serverless Job on an H100 (job aijob-e00d4hdmhnwrthgr63, about 9 minutes).
          On the 39 held-out letters it caught 15 of 16 hidden instructions with 0 false alarms in 23 clean letters, against 16 and 19 for the untuned model.
        </p>
        <p className="muted" style={{ margin: 0, fontSize: 14 }}>Its one miss has no text: the instruction is only in the page image, which a live check sends to the vision reading. Live checks still use the NeMo Guardrails rail.</p>
      </section>

      <section>
        <p className="label" style={{ margin: "0 0 12px" }}>Limits, stated plainly</p>
        <ul className="card pad" style={{ margin: 0, paddingLeft: 38, display: "grid", gap: 8 }}>
          {LIMITS.map((l) => <li key={l}>{l}</li>)}
        </ul>
      </section>
    </div>
  );
}
