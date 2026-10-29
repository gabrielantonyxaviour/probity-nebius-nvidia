// Step `screen`: Lightning (thinking off) reads every untrusted span and flags text aimed at an automated reviewer.
// Text is cleaned first (see sanitize.ts) and base64 blobs are decoded and screened too. Flagged letter lines are withheld from every later prompt.
import type { HiddenText, ModelCall, Run, Screen } from "@probity/shared";
import { callJson } from "../models/structured";
import { SCREEN_SYSTEM, screenUser, type Span } from "../prompts/screen";
import { emailSpans } from "./eml";
import { decodedBlobs, mergeFindings, sanitize } from "./sanitize";
import { ScreenAnswer } from "./schemas";
import type { Ctx, Scratch, StageOut } from "./types";

const MAX_SPANS = 160;

export async function screenSpans(ctx: Ctx, stepKey: string, spans: Span[]): Promise<{ flags: Screen["flags"]; flaggedIds: number[]; calls: ModelCall[] }> {
  if (spans.length === 0) return { flags: [], flaggedIds: [], calls: [] };
  const res = await callJson(
    ctx.env,
    { model: "nvidia/Nemotron-3_5-Lightning", thinking: false, agent: "screen", stepKey, maxTokens: 1500, messages: [{ role: "system", content: SCREEN_SYSTEM }, { role: "user", content: screenUser(spans) }] },
    { name: "screen", schema: ScreenAnswer },
  );
  const byId = new Map(spans.map((s) => [s.id, s]));
  const flags: Screen["flags"] = [];
  const flaggedIds: number[] = [];
  for (const f of res.data.flagged) {
    const s = byId.get(f.id);
    if (!s || flaggedIds.includes(f.id)) continue;
    flaggedIds.push(f.id);
    flags.push({ source: s.source, text: s.text.slice(0, 400), why: f.why.slice(0, 200), by: "lightning" });
  }
  return { flags, flaggedIds, calls: res.calls };
}

export async function screenStage(ctx: Ctx, s: Scratch): Promise<StageOut> {
  let findings = s.findings;
  const spans: Span[] = [];
  const owner = new Map<number, string | null>(); // span id -> the letter line it came from
  const add = (source: Span["source"], text: string, lineId: string | null, invisible = false) => {
    if (spans.length >= MAX_SPANS) return;
    const id = spans.length + 1;
    spans.push({ id, source, text, invisible });
    owner.set(id, lineId);
  };
  const addBlobs = (source: Span["source"], text: string, lineId: string | null) => {
    for (const d of decodedBlobs(text)) {
      findings = { ...findings, encoded: findings.encoded + 1 };
      add(source, `Decoded from base64: ${sanitize(d).text}`, lineId);
    }
  };
  for (const l of s.lines) {
    add("letter", l.text, l.id, !!l.hidden);
    addBlobs("letter", l.text, l.id);
  }
  for (const e of emailSpans(s.emlText, 1, s.letterKind === "body")) {
    const c = sanitize(e.text);
    findings = mergeFindings(findings, { ...c.findings, encoded: 0 });
    add("email", c.text, null);
    addBlobs("email", c.text, null);
  }
  const { flags, flaggedIds, calls } = await screenSpans(ctx, "screen", spans);
  const withheld = [...new Set(flaggedIds.map((id) => owner.get(id)).filter((x): x is string => !!x))];
  // Metadata is only worth the clerk's attention when it carries an instruction.
  const softFlagged: HiddenText[] = s.lines
    .filter((l) => l.soft && withheld.includes(l.id))
    .map((l) => ({ page: l.page, text: l.text, why: "off_page" as const, detail: l.hidden?.detail ?? "PDF metadata", bbox: null }));
  await ctx.store.update(ctx.runId, (r: Run) => {
    r.screen = { spansScreened: spans.length, flags };
    if (r.letter && softFlagged.length) r.letter.hidden = [...r.letter.hidden, ...softFlagged];
  });
  const odd = findings.zeroWidth + findings.bidi + findings.lookalikes.length;
  const extra = [odd ? `${odd} disguised characters or words cleaned` : null, findings.encoded ? `${findings.encoded} encoded text decoded` : null].filter(Boolean).join("; ");
  const summary = `${spans.length} lines screened; ${flags.length ? `${flags.length} aimed at a reviewer, withheld from the readers` : "none aimed at a reviewer"}${extra ? `; ${extra}` : ""}`;
  return { scratch: { ...s, withheld, findings }, summary, calls };
}
