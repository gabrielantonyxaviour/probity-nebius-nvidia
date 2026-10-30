"use client";
import { useEffect, useRef, useState } from "react";
import { IsoStack } from "./iso-stack";

export const STEPS = [
  { tag: "01 Arrives", title: "A vendor asks to change where you pay them.", who: ["Gmail", "Outlook", "Upload"],
    body: "Probity watches your AP mailbox. A bank-change e-mail becomes a request within minutes, with the letter attached. Other mail is ignored and never stored." },
  { tag: "02 Reads", title: "It reads what the letter asks, and what it hides.", who: ["Nemotron 3 Ultra", "Code"],
    body: "Nemotron 3 Ultra reads the new account, the routing number and who signed. Code pulls every line's colour, size and position from the PDF, so white-on-white and 1-point text are caught before any model sees them." },
  { tag: "03 Screens", title: "Every line is screened for orders aimed at an AI.", who: ["Nemotron 3.5 Lightning", "NeMo Guardrails"],
    body: "Forged letters now carry instructions for the AI reviewing them. Lightning screens every line of the letter, the e-mail and every web page. A flagged line becomes evidence, never an instruction." },
  { tag: "04 Looks up", title: "It finds a number that didn't come from the letter.", who: ["SEC EDGAR", "USAspending", "GLEIF", "Tavily"],
    body: "Lightning plans the lookups by tool call: public registries, your vendor master, and the vendor's own website. When two sources agree on a phone number, that's the one your team calls." },
  { tag: "05 Decides", title: "Approve, call back or hold. Code decides, never a model.", who: ["Payment policy", "Slack", "E-mail"],
    body: "The verdict lands in your AP channel with the number to call and buttons to log the call. Before each cut-off, every open request is checked again." },
];

/** Griffin-style scroll story: numbered steps on the left, a sticky exploded stack on the right that follows the active step. */
export function Story() {
  const [active, setActive] = useState(0);
  const refs = useRef<Array<HTMLDivElement | null>>([]);
  useEffect(() => {
    const io = new IntersectionObserver((es) => {
      for (const e of es) if (e.isIntersecting) setActive(Number((e.target as HTMLElement).dataset.i));
    }, { rootMargin: "-45% 0px -45% 0px" });
    refs.current.forEach((el) => el && io.observe(el));
    return () => io.disconnect();
  }, []);
  return (
    <div className="lp-story" id="how">
      <div className="lp-steps">
        {STEPS.map((s, i) => (
          <div key={s.tag} data-i={i} ref={(el) => { refs.current[i] = el; }} className={`lp-step${i === active ? " on" : ""}`}>
            <span className="lp-step-dot" aria-hidden="true" />
            <span className="lp-mono">{s.tag}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            <div className="who">{s.who.map((w) => <span key={w} className="lp-tag lp-mono">{w}</span>)}</div>
          </div>
        ))}
      </div>
      <div className="lp-stage" aria-hidden="true"><IsoStack active={active} /></div>
    </div>
  );
}
