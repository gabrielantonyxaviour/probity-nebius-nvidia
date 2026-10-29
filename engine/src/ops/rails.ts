// The same two NeMo Guardrails self-check rails as job/config, run inside the app through Token Factory.
// Prompts are generated from job/config/prompts.yml (scripts/embed-job.ts), so there is one source of truth.
// Answer parsing mirrors NeMo's `is_content_safe`: "yes" = block, "no" = allow, anything unreadable fails closed.
import { chat, type ModelEnv } from "../models/client";
import { RAILS_PROMPTS } from "./rails-prompts.generated";
import type { WorkItem } from "./work";

const SPAN_CHARS = 6000;
const MODEL = "nvidia/Nemotron-3_5-Lightning" as const;

export function parseRailAnswer(answer: string): "block" | "allow" {
  const words = answer.toLowerCase().replace(/\W+/g, " ").trim().split(" ");
  if (words.includes("unsafe") || words.includes("yes")) return "block";
  if (words.includes("safe") || words.includes("no")) return "allow";
  return "block";
}

const render = (template: string, vars: Record<string, string>): string => template.replace(/\{\{\s*(\w+)\s*\}\}/g, (_m, k: string) => vars[k] ?? "");

async function ask(env: ModelEnv, task: "self_check_input" | "self_check_output", vars: Record<string, string>, stepKey: string): Promise<{ blocked: boolean; costUsd: number }> {
  const p = RAILS_PROMPTS[task];
  const r = await chat(env, { model: MODEL, thinking: false, agent: "screen", stepKey, maxTokens: p.maxTokens, temperature: 0, messages: [{ role: "user", content: render(p.content, vars) }] });
  return { blocked: parseRailAnswer(r.content) === "block", costUsd: r.call.costUsd };
}

/** True when the input rail would block this text: it addresses an automated reviewer. */
export const railInput = (env: ModelEnv, text: string, stepKey = "rail_input") => ask(env, "self_check_input", { user_input: text.slice(0, SPAN_CHARS) }, stepKey);
/** True when the output rail would block this rationale: it states something its evidence does not support. */
export const railOutput = (env: ModelEnv, evidence: string, rationale: string, stepKey = "rail_output") =>
  ask(env, "self_check_output", { user_input: evidence.slice(0, SPAN_CHARS), bot_response: rationale.slice(0, SPAN_CHARS) }, stepKey);

export type RailsPass = { requestsSwept: number; sweptRequestIds: string[]; flaggedRequestIds: string[]; nemo: { spansChecked: number; flagged: number; outputChecks: number; outputBlocked: number }; costUsd: number };

/** Runs both rails over a company's open requests, like job/sweep.py does, four at a time. */
export async function railsPass(env: ModelEnv, items: WorkItem[], concurrency = 4): Promise<RailsPass> {
  const out: RailsPass = { requestsSwept: items.length, sweptRequestIds: items.map((i) => i.requestId), flaggedRequestIds: [], nemo: { spansChecked: 0, flagged: 0, outputChecks: 0, outputBlocked: 0 }, costUsd: 0 };
  let next = 0;
  const worker = async (): Promise<void> => {
    for (let i = next++; i < items.length; i = next++) {
      const item = items[i]!;
      let flagged = false;
      for (const span of item.spans.filter((s) => s.text.trim())) {
        const r = await railInput(env, span.text);
        out.nemo.spansChecked++;
        out.costUsd += r.costUsd;
        if (r.blocked) { out.nemo.flagged++; flagged = true; }
      }
      if (item.rationale) {
        const evidence = item.evidence.map((e) => `- ${e.label}: ${e.value}`).join("\n") || "(no evidence recorded)";
        const r = await railOutput(env, evidence, item.rationale);
        out.nemo.outputChecks++;
        out.costUsd += r.costUsd;
        if (r.blocked) { out.nemo.outputBlocked++; flagged = true; }
      }
      if (flagged) out.flaggedRequestIds.push(item.requestId);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, worker));
  out.flaggedRequestIds.sort();
  out.costUsd = Math.round(out.costUsd * 1e6) / 1e6;
  return out;
}
