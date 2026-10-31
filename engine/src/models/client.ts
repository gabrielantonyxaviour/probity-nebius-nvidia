// Nebius Token Factory client (OpenAI-compatible chat completions). Every Probity model call goes through here,
// and every call leaves a ModelCall record with real usage, cached tokens and cost.
import type { AgentKey, ModelCall, ModelId } from "@probity/shared";
import { z } from "zod";
import { hasDb, isStopped, LIMIT_MESSAGE, reserve, settle, STOPPED_MESSAGE, worstCaseUsd } from "./daycap";
import { costUsd } from "./prices";

export type ModelEnv = { NEBIUS_API_KEY: string; NEBIUS_BASE_URL?: string; fetchImpl?: typeof fetch };

export type Part = { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };
export type WireToolCall = { id: string; type: "function"; function: { name: string; arguments: string } };
export type Msg = {
  role: "system" | "user" | "assistant" | "tool";
  content: string | Part[] | null;
  tool_calls?: WireToolCall[];
  tool_call_id?: string;
};
export type ToolDef = { type: "function"; function: { name: string; description?: string; parameters: Record<string, unknown> } };

export interface ChatOptions {
  model: ModelId;
  thinking: boolean;
  agent: AgentKey;
  stepKey: string;
  messages: Msg[];
  maxTokens: number;
  schema?: { name: string; schema: Record<string, unknown> };
  tools?: ToolDef[];
  toolChoice?: "auto" | "none" | { type: "function"; function: { name: string } };
  temperature?: number;
}

export interface ChatResult {
  content: string;
  reasoning: string | null;
  toolCalls: WireToolCall[];
  finishReason: string | null;
  call: ModelCall;
}

export class ModelError extends Error {
  /** Calls that were billed before the failure, so the run still counts their cost. */
  calls: ModelCall[] = [];
  constructor(message: string, readonly status: number | null, readonly code: "http" | "timeout" | "network" | "parse" | "limit") {
    super(message);
  }
}

const DEFAULT_BASE = "https://api.tokenfactory.nebius.com/v1";
const TIMEOUT_MS = 90_000;
const MAX_RETRIES = 3;

const Wire = z.object({
  id: z.string().optional(),
  choices: z
    .array(
      z.object({
        finish_reason: z.string().nullable().optional(),
        message: z.object({
          content: z.string().nullable().optional(),
          reasoning_content: z.string().nullable().optional(),
          reasoning: z.string().nullable().optional(),
          tool_calls: z
            .array(z.object({ id: z.string(), type: z.string().optional(), function: z.object({ name: z.string(), arguments: z.string() }) }))
            .nullable()
            .optional(),
        }),
      }),
    )
    .min(1),
  usage: z
    .object({
      prompt_tokens: z.number().optional(),
      completion_tokens: z.number().optional(),
      prompt_tokens_details: z.object({ cached_tokens: z.number().nullable().optional() }).nullable().optional(),
      prompt_cache_hit_tokens: z.number().nullable().optional(),
    })
    .nullable()
    .optional(),
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const retryable = (status: number) => status === 429 || status >= 500;

/** Removes inline reasoning that some deployments leave in `content`. */
export function stripThinking(text: string): string {
  return text.replace(/<think>[\s\S]*?<\/think>/g, "").replace(/^[\s\S]*?<\/think>/, "").trim();
}

export function toBase64(bytes: Uint8Array): string {
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}

export function imagePart(bytes: Uint8Array, mime: "image/png" | "image/jpeg" = "image/png"): Part {
  return { type: "image_url", image_url: { url: `data:${mime};base64,${toBase64(bytes)}` } };
}

function body(o: ChatOptions): Record<string, unknown> {
  const b: Record<string, unknown> = {
    model: o.model,
    messages: o.messages,
    max_tokens: o.maxTokens,
    temperature: o.temperature ?? (o.thinking ? 0.6 : 0),
    chat_template_kwargs: { enable_thinking: o.thinking },
  };
  if (o.schema) b.response_format = { type: "json_schema", json_schema: { name: o.schema.name, schema: o.schema.schema, strict: true } };
  if (o.tools?.length) {
    b.tools = o.tools;
    b.tool_choice = o.toolChoice ?? "auto";
  }
  return b;
}

export async function chat(env: ModelEnv, o: ChatOptions): Promise<ChatResult> {
  const doFetch = env.fetchImpl ?? fetch;
  const url = `${(env.NEBIUS_BASE_URL ?? DEFAULT_BASE).replace(/\/$/, "")}/chat/completions`;
  const payload = JSON.stringify(body(o));
  const startedAt = new Date().toISOString();
  const t0 = Date.now();
  let lastErr: ModelError | null = null;
  // The daily cap and the kill switch apply to every call made with the Worker's env (it carries the database).
  const capped = hasDb(env);
  if (capped && (await isStopped(env))) throw new ModelError(STOPPED_MESSAGE, null, "limit");
  const worst = capped ? worstCaseUsd(o.model, o.messages, o.maxTokens) : 0;

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 0) await sleep(Math.min(8000, 600 * 2 ** (attempt - 1)) + Math.random() * 250);
    if (capped && !(await reserve(env, worst))) throw new ModelError(LIMIT_MESSAGE, null, "limit");
    let actual = 0; // what this attempt cost; settled against the reservation in `finally`
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
    try {
      const res = await doFetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${env.NEBIUS_API_KEY}` },
        body: payload,
        signal: ctrl.signal,
      });
      const text = await res.text();
      if (!res.ok) {
        lastErr = new ModelError(`Token Factory ${res.status}: ${text.slice(0, 300)}`, res.status, "http");
        if (retryable(res.status) && attempt < MAX_RETRIES) continue;
        throw lastErr;
      }
      let json: unknown;
      try {
        json = JSON.parse(text);
      } catch {
        actual = worst;
        throw new ModelError("Token Factory returned a body that is not JSON", res.status, "parse");
      }
      const parsed = Wire.safeParse(json);
      if (!parsed.success) { actual = worst; throw new ModelError("Token Factory response had an unexpected shape", res.status, "parse"); }
      const result = toResult(o, parsed.data, startedAt, Date.now() - t0);
      actual = result.call.costUsd;
      return result;
    } catch (e) {
      if (e instanceof ModelError) {
        if (e.code === "http" && !retryable(e.status ?? 0)) throw e;
        if (e.code === "parse") throw e;
        lastErr = e;
        if (attempt === MAX_RETRIES) throw e;
        continue;
      }
      const aborted = e instanceof Error && e.name === "AbortError";
      if (aborted) actual = worst; // a timed-out call may still have been billed
      lastErr = new ModelError(aborted ? "Token Factory timed out after 90 s" : "Token Factory was unreachable", null, aborted ? "timeout" : "network");
      if (attempt === MAX_RETRIES) throw lastErr;
    } finally {
      clearTimeout(timer);
      if (capped) await settle(env, worst, actual).catch(() => undefined);
    }
  }
  throw lastErr ?? new ModelError("Token Factory call failed", null, "network");
}

function toResult(o: ChatOptions, w: z.infer<typeof Wire>, startedAt: string, ms: number): ChatResult {
  const choice = w.choices[0]!;
  const toolCalls: WireToolCall[] = (choice.message.tool_calls ?? []).map((t) => ({
    id: t.id,
    type: "function",
    function: { name: t.function.name, arguments: t.function.arguments },
  }));
  const promptTokens = w.usage?.prompt_tokens ?? 0;
  // Token Factory reports cache hits in prompt_tokens_details.cached_tokens; some deployments also send prompt_cache_hit_tokens.
  const cachedTokens = Math.max(w.usage?.prompt_tokens_details?.cached_tokens ?? 0, w.usage?.prompt_cache_hit_tokens ?? 0);
  const completionTokens = w.usage?.completion_tokens ?? 0;
  const call: ModelCall = {
    id: `mc-${crypto.randomUUID().slice(0, 8)}`,
    stepKey: o.stepKey,
    agent: o.agent,
    model: o.model,
    thinking: o.thinking,
    startedAt,
    ms,
    promptTokens,
    cachedTokens,
    completionTokens,
    costUsd: costUsd(o.model, { promptTokens, cachedTokens, completionTokens }),
    requestId: w.id ?? null,
    toolCalls: toolCalls.map((t) => t.function.name),
  };
  return {
    content: stripThinking(choice.message.content ?? ""),
    reasoning: choice.message.reasoning_content ?? choice.message.reasoning ?? null,
    toolCalls,
    finishReason: choice.finish_reason ?? null,
    call,
  };
}
