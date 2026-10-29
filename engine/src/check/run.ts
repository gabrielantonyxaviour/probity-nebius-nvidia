// Run bookkeeping: a fresh Run, step transitions, running totals.
import type { AgentKey, ModelCall, Run, Step } from "@probity/shared";
import { ModelError } from "../models/client";
import { recordCalls } from "../ops/spend";
import type { Ctx, Scratch, StageOut } from "./types";

export const STEP_DEFS: Array<{ key: string; agent: AgentKey | null; label: string }> = [
  { key: "pdf", agent: null, label: "Opening the letter and rendering its pages" },
  { key: "screen", agent: "screen", label: "Screening every line for text aimed at a reviewer" },
  { key: "read_text", agent: "letter_reader", label: "Reading the letter's text" },
  { key: "read_image", agent: "letter_reader", label: "Reading the page image a second time" },
  { key: "scout", agent: "registry_scout", label: "Checking registries and our own records" },
  { key: "examine", agent: "identity_examiner", label: "Linking the letter to the evidence" },
  { key: "gate", agent: null, label: "Applying the payment policy" },
  { key: "rationale", agent: "gate_officer", label: "Writing the note for the clerk" },
];

export function newRun(o: { id: string; requestId: string; vendorName: string; live: boolean }): Run {
  return {
    id: o.id,
    requestId: o.requestId,
    vendorName: o.vendorName,
    status: "queued",
    live: o.live,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    steps: STEP_DEFS.map((s): Step => ({ ...s, status: "pending", startedAt: null, finishedAt: null, summary: null })),
    calls: [],
    evidence: [],
    letter: null,
    screen: null,
    decision: null,
    totals: { costUsd: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, tavilyCredits: 0 },
    error: null,
  };
}

export function addCalls(run: Run, calls: ModelCall[]): void {
  run.calls.push(...calls);
  const t = run.totals;
  t.costUsd = Math.round(run.calls.reduce((n, c) => n + c.costUsd, 0) * 1e6) / 1e6;
  t.promptTokens = run.calls.reduce((n, c) => n + c.promptTokens, 0);
  t.cachedTokens = run.calls.reduce((n, c) => n + c.cachedTokens, 0);
  t.completionTokens = run.calls.reduce((n, c) => n + c.completionTokens, 0);
}

const setStep = (run: Run, key: string, patch: Partial<Step>) => {
  const s = run.steps.find((x) => x.key === key);
  if (s) Object.assign(s, patch);
};

/** What the clerk may see when a step fails: plain words, no stack, no provider detail. */
export function plainError(e: unknown): string {
  if (e instanceof ModelError) return e.code === "timeout" ? "A model took too long to answer." : "A model service did not answer correctly.";
  return e instanceof Error && e.message && e.message.length < 140 ? e.message : "The check stopped because of an internal error.";
}

/** Every Token Factory call counts toward the all-time Nebius budget. A bookkeeping failure never fails a check. */
async function spend(ctx: Ctx, calls: ModelCall[] | undefined): Promise<void> {
  if (!calls?.length) return;
  try {
    await recordCalls(ctx.env, ctx.orgId, ctx.runId, calls);
  } catch {
    /* the run matters more than its ledger line */
  }
}

/** Runs one step: marks it running, runs it, records its calls and summary. Failure marks the step failed and rethrows. */
export async function runStep(ctx: Ctx, key: string, fn: () => Promise<StageOut>): Promise<Scratch> {
  await ctx.store.update(ctx.runId, (r) => {
    if (r.status === "queued") r.status = "running";
    setStep(r, key, { status: "running", startedAt: new Date().toISOString(), finishedAt: null, summary: null });
  });
  try {
    const out = await fn();
    await ctx.store.update(ctx.runId, (r) => {
      if (out.calls?.length) addCalls(r, out.calls);
      setStep(r, key, { status: out.skipped ? "skipped" : "done", finishedAt: new Date().toISOString(), summary: out.summary });
    });
    await spend(ctx, out.calls);
    return out.scratch;
  } catch (e) {
    await ctx.store.update(ctx.runId, (r) => {
      if (e instanceof ModelError && e.calls.length) addCalls(r, e.calls);
      setStep(r, key, { status: "failed", finishedAt: new Date().toISOString(), summary: plainError(e) });
    });
    if (e instanceof ModelError) await spend(ctx, e.calls);
    throw e;
  }
}

export async function failRun(ctx: Ctx, e: unknown): Promise<void> {
  await ctx.store.update(ctx.runId, (r) => {
    r.status = "failed";
    r.error = plainError(e);
    r.finishedAt = new Date().toISOString();
  });
}

export async function finishRun(ctx: Ctx): Promise<void> {
  await ctx.store.update(ctx.runId, (r) => {
    r.status = "done";
    r.finishedAt = new Date().toISOString();
  });
}
