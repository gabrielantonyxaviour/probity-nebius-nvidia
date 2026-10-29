// Step `examine`: Nemotron 3 Ultra (thinking on) links the letter's claims to the evidence and reports conflicts.
import type { Evidence } from "@probity/shared";
import { callJson } from "../models/structured";
import { domainOfAddress } from "../policy/normalise";
import { ExaminerOutput } from "../policy/types";
import { EXAMINER_SYSTEM } from "../prompts/examiner";
import type { Ctx, Scratch, StageOut } from "./types";

const known = (ids: string[], have: Set<string>) => ids.filter((id) => have.has(id));

export async function examineStage(ctx: Ctx, s: Scratch): Promise<StageOut> {
  const run = await ctx.store.get(ctx.runId);
  const evidence: Evidence[] = run.evidence;
  const have = new Set(evidence.map((e) => e.id));
  const flagged = run.screen?.flags.length ?? 0;
  const input = {
    vendorOnFile: { name: s.request.vendorName, remitAddress: s.request.vendorOnFile.remitAddress, accountOnFile: s.request.vendorOnFile.accountMasked },
    request: {
      kind: s.request.kind,
      senderDomain: domainOfAddress(s.request.email.from),
      replyToDomain: s.request.email.replyTo ? domainOfAddress(s.request.email.replyTo) : null,
    },
    letter: {
      claims: s.claims.map((c) => ({ field: c.field, value: c.value, quote: c.quote })),
      linesInvisibleOnPage: run.letter?.hidden.length ?? 0,
      spansWithheldBecauseAimedAtReviewer: flagged,
    },
    evidence: evidence.map((e) => ({ id: e.id, source: e.source, field: e.field, label: e.label, value: e.value.slice(0, 400) })),
  };
  const res = await callJson(
    ctx.env,
    {
      model: "nvidia/Nemotron-3-Ultra-550b-a55b",
      thinking: true,
      agent: "identity_examiner",
      stepKey: "examine",
      maxTokens: 9000,
      messages: [{ role: "system", content: EXAMINER_SYSTEM }, { role: "user", content: `<case>\n${JSON.stringify(input, null, 1)}\n</case>\nJudge entity, address and conflicts.` }],
    },
    { name: "identity_examination", schema: ExaminerOutput },
  );
  const d = res.data;
  const examiner = {
    entity: { ...d.entity, evidenceIds: known(d.entity.evidenceIds, have) },
    address: { ...d.address, evidenceIds: known(d.address.evidenceIds, have) },
    conflicts: d.conflicts.map((c) => ({ ...c, evidenceIds: known(c.evidenceIds, have) })),
  };
  return {
    scratch: { ...s, examiner },
    summary: `Company: ${examiner.entity.verdict.replace("_", " ")}; remit address: ${examiner.address.verdict.replace("_", " ")}${examiner.conflicts.length ? `; ${examiner.conflicts.length} conflict${examiner.conflicts.length === 1 ? "" : "s"}` : ""}`,
    calls: res.calls,
  };
}
