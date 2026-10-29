// Step `screen`: Lightning (thinking off) reads every untrusted span and flags text aimed at an automated reviewer.
// Flagged letter lines are withheld from every later prompt.
import type { ModelCall, Run, Screen } from "@probity/shared";
import { callJson } from "../models/structured";
import { SCREEN_SYSTEM, screenUser, type Span } from "../prompts/screen";
import { emailSpans } from "./eml";
import { ScreenAnswer } from "./schemas";
import type { Ctx, StageOut } from "./types";

export async function screenSpans(ctx: Ctx, stepKey: string, spans: Span[]): Promise<{ flags: Screen["flags"]; calls: ModelCall[] }> {
  if (spans.length === 0) return { flags: [], calls: [] };
  const res = await callJson(
    ctx.env,
    { model: "nvidia/Nemotron-3_5-Lightning", thinking: false, agent: "screen", stepKey, maxTokens: 1200, messages: [{ role: "system", content: SCREEN_SYSTEM }, { role: "user", content: screenUser(spans) }] },
    { name: "screen", schema: ScreenAnswer },
  );
  const byId = new Map(spans.map((s) => [s.id, s]));
  const flags: Screen["flags"] = [];
  for (const f of res.data.flagged) {
    const s = byId.get(f.id);
    if (s) flags.push({ source: s.source, text: s.text.slice(0, 400), why: f.why.slice(0, 200), by: "lightning" });
  }
  return { flags, calls: res.calls };
}

export async function screenStage(ctx: Ctx, s: import("./types").Scratch): Promise<StageOut> {
  const letterSpans: Span[] = s.lines.map((l, k) => ({ id: k + 1, source: "letter" as const, text: l.text, invisible: !!l.hidden }));
  const spans = [...letterSpans, ...emailSpans(s.emlText, letterSpans.length + 1, s.letterKind === "body")].slice(0, 120);
  const { flags, calls } = await screenSpans(ctx, "screen", spans);
  const flaggedLetter = new Set(flags.filter((f) => f.source === "letter").map((f) => f.text));
  const withheld = s.lines.filter((l) => flaggedLetter.has(l.text.slice(0, 400))).map((l) => l.id);
  await ctx.store.update(ctx.runId, (r: Run) => {
    r.screen = { spansScreened: spans.length, flags };
  });
  const summary = flags.length ? `${spans.length} lines screened; ${flags.length} aimed at a reviewer, withheld from the readers` : `${spans.length} lines screened; none aimed at a reviewer`;
  return { scratch: { ...s, withheld }, summary, calls };
}
