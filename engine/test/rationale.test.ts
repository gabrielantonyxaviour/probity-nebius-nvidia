import { describe, expect, it } from "vitest";
import { gate } from "../src/policy/gate";
import { checkRationale, rationaleFacts, templateRationale } from "../src/policy/rationale";
import { clean } from "./helpers";

const facts = () => {
  const i = clean();
  return rationaleFacts(i, gate(i), false);
};

describe("rationale number check", () => {
  it("accepts a note whose numbers all come from the facts", () => {
    const f = facts();
    const note = `Call (321) 727-9100 (Registered business phone (SEC)) before $48,210.00 is paid to L3Harris Technologies, Inc., and do not use (321) 555-0100.`;
    expect(checkRationale(note, f)).toEqual({ ok: true, failures: [] });
  });
  it("rejects an invented amount, an invented phone and a wrong decision word", () => {
    const f = facts();
    expect(checkRationale("Pay $48,310.00 after a call.", f).failures.join()).toMatch(/number 310/);
    expect(checkRationale("Call (703) 902-5000 first.", f).failures.join()).toMatch(/not in the facts/);
    expect(checkRationale("This is a HOLD. Call (321) 727-9100.", f).failures.join()).toMatch(/other decision word HOLD/);
  });
  it("rejects offering the letter's number as the one to call", () => {
    expect(checkRationale("Call (321) 555-0100 to confirm.", facts()).failures.join()).toMatch(/letter number/);
  });
  it("rejects more than three sentences and accusing words", () => {
    const f = facts();
    expect(checkRationale("One. Two. Three. Four.", f).failures.join()).toMatch(/4 sentences/);
    expect(checkRationale("This looks like fraud.", f).ok).toBe(false);
  });
  it("the template always passes its own check, whatever the verdict", () => {
    for (const over of [{}, { readingsDisagree: ["account number"] }]) {
      const i = clean(over);
      const f = rationaleFacts(i, gate(i), false);
      const t = templateRationale(f);
      expect(checkRationale(t, f), t).toEqual({ ok: true, failures: [] });
    }
    const i = clean({ evidence: [] });
    const f = rationaleFacts(i, gate(i), false);
    expect(checkRationale(templateRationale(f), f).ok).toBe(true);
  });
});
