import { LiveNumbers } from "@/components/live-numbers";
import { BeforeRun, Pipeline } from "@/components/inapp/pipeline";

export const metadata = { title: "How it works · Probity" };

const FACTS: Array<[string, string]> = [["6", "steps"], ["2", "readings"], ["3", "Nemotron models"], ["0", "can approve"]];

/** In-app "How it works": the check as a pipeline, the pre-run re-check, and the measured numbers. */
export default function InAppHowPage() {
  return (
    <div className="wrap ia">
      <header className="ia-head">
        <div>
          <p className="label" style={{ margin: 0 }}>How it works</p>
          <h1 className="serif">Every letter, read twice and checked against the record.</h1>
        </div>
        <div className="ia-facts" aria-label="At a glance">
          {FACTS.map(([b, s]) => <div key={s} className="ia-fact"><b className="num">{b}</b><span>{s}</span></div>)}
        </div>
      </header>
      <Pipeline />
      <section className="ia-band" aria-label="Before every payment run and measured numbers">
        <BeforeRun />
        <LiveNumbers />
      </section>
    </div>
  );
}
