// Steps `gate` (pure code) and `rationale` (Nemotron 3.5 Lightning, thinking off, numbers checked by code).
import type { ModelCall, Run } from "@probity/shared";
import { callJson } from "../models/structured";
import { callbackOnRecord, gate } from "../policy/gate";
import { checkRationale, rationaleFacts, templateRationale } from "../policy/rationale";
import { phonesIn } from "../policy/normalise";
import type { GateInput } from "../policy/types";
import { RATIONALE_SYSTEM } from "../prompts/rationale";
import { RationaleAnswer } from "./schemas";
import type { Ctx, Scratch, StageOut } from "./types";

export function gateInputOf(run: Run, s: Scratch): GateInput {
  return {
    request: s.request,
    letter: run.letter ?? { pageCount: 0, pageImages: [], pageSize: [612, 792], claims: [], hidden: [], scanned: false },
    screen: run.screen ?? { spansScreened: 0, flags: [] },
    evidence: run.evidence,
    examiner: s.examiner,
    pressure: s.pressure,
    letterPhones: [...new Set([...s.letterPhones, ...s.claims.filter((c) => c.field === "phone").flatMap((c) => phonesIn(c.value))])],
    readingsDisagree: s.readingsDisagree,
  };
}

export async function gateStage(ctx: Ctx, s: Scratch): Promise<StageOut> {
  const run = await ctx.store.get(ctx.runId);
  const decision = gate(gateInputOf(run, s));
  await ctx.store.update(ctx.runId, (r: Run) => {
    r.decision = decision;
  });
  const holds = decision.reasons.filter((r) => r.severity === "hold").length;
  return { scratch: s, summary: `${decision.verdict.replace("_", " ").toLowerCase()}: ${decision.reasons.length} reasons${holds ? `, ${holds} of them stop the change` : ""}` };
}

export async function rationaleStage(ctx: Ctx, s: Scratch): Promise<StageOut> {
  const run = await ctx.store.get(ctx.runId);
  const input = gateInputOf(run, s);
  const decision = run.decision;
  if (!decision) throw new Error("The policy gate has not run.");
  const facts = rationaleFacts(input, decision, callbackOnRecord(input));
  const calls: ModelCall[] = [];
  let text: string | null = null;
  let note = "";
  let lastFailure = "";
  for (let attempt = 0; attempt < 2 && !text; attempt++) {
    const user = `<facts>\n${JSON.stringify(facts, null, 1)}\n</facts>\n${note}Write the note.`;
    const res = await callJson(
      ctx.env,
      { model: "nvidia/Nemotron-3_5-Lightning", thinking: false, agent: "gate_officer", stepKey: "rationale", maxTokens: 500, messages: [{ role: "system", content: RATIONALE_SYSTEM }, { role: "user", content: user }] },
      { name: "clerk_note", schema: RationaleAnswer },
    );
    calls.push(...res.calls);
    const candidate = res.data.text.replace(/\s+/g, " ").trim();
    const check = checkRationale(candidate, facts);
    if (check.ok) text = candidate;
    else {
      lastFailure = check.failures.join("; ");
      note = `Your previous note was rejected: ${lastFailure}. Use only the facts given.\n`;
    }
  }
  const template = text === null;
  const final = text ?? templateRationale(facts);
  const checked = checkRationale(final, facts).ok;
  await ctx.store.update(ctx.runId, (r: Run) => {
    if (r.decision) {
      r.decision.rationale = final;
      r.decision.rationaleChecked = checked;
    }
  });
  return { scratch: s, summary: template ? `Note written from the facts (the model's wording failed the check: ${lastFailure.slice(0, 120)})` : "Note written; every number checked against the facts", calls };
}
