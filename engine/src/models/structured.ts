// Structured output over Token Factory. First try: response_format json_schema (strict). If the API refuses it
// or the answer does not parse, retry once with a forced single `submit` tool call whose parameters are the schema.
// Everything is validated with zod before it leaves this file.
import type { ModelCall } from "@probity/shared";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { chat, ModelError, type ChatOptions, type ChatResult, type ModelEnv } from "./client";

export type JsonOptions = Omit<ChatOptions, "schema" | "tools" | "toolChoice">;

export function jsonSchemaOf(schema: z.ZodTypeAny): Record<string, unknown> {
  const out = zodToJsonSchema(schema, { $refStrategy: "none", target: "jsonSchema7" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}

/** Pulls the first balanced JSON object out of model text (fences and prose tolerated). */
export function extractJson(text: string): unknown {
  const t = text.replace(/```(?:json)?/gi, "").trim();
  const start = t.indexOf("{");
  if (start < 0) throw new ModelError("No JSON object in the answer", null, "parse");
  let depth = 0;
  let inStr = false;
  for (let i = start; i < t.length; i++) {
    const c = t[i]!;
    if (inStr) {
      if (c === "\\") i++;
      else if (c === '"') inStr = false;
    } else if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(t.slice(start, i + 1));
      } catch {
        throw new ModelError("The JSON object in the answer is malformed", null, "parse");
      }
    }
  }
  throw new ModelError("The JSON object in the answer is cut off", null, "parse");
}

function parseResult<T>(schema: z.ZodType<T>, r: ChatResult, viaTool: boolean): T {
  const raw = viaTool ? r.toolCalls.find((t) => t.function.name === "submit")?.function.arguments : r.content;
  if (!raw) throw new ModelError("The model returned no structured answer", null, "parse");
  const parsed = schema.safeParse(extractJson(raw));
  if (!parsed.success) throw new ModelError(`The answer did not match the schema: ${parsed.error.issues[0]?.message ?? "invalid"}`, null, "parse");
  return parsed.data;
}

export interface JsonResult<T> {
  data: T;
  calls: ModelCall[];
  reasoning: string | null;
  /** "schema" when response_format worked, "tool" when the forced-tool fallback was needed. */
  via: "schema" | "tool";
}

export async function callJson<T>(env: ModelEnv, base: JsonOptions, spec: { name: string; schema: z.ZodType<T> }): Promise<JsonResult<T>> {
  const js = jsonSchemaOf(spec.schema);
  const calls: ModelCall[] = [];
  try {
    const r = await chat(env, { ...base, schema: { name: spec.name, schema: js } });
    calls.push(r.call);
    return { data: parseResult(spec.schema, r, false), calls, reasoning: r.reasoning, via: "schema" };
  } catch (first) {
    const recoverable = first instanceof ModelError && (first.code === "parse" || first.status === 400 || first.status === 422);
    if (!recoverable) throw first;
  }
  try {
    const r = await chat(env, {
      ...base,
      tools: [{ type: "function", function: { name: "submit", description: "Submit the final answer.", parameters: js } }],
      toolChoice: { type: "function", function: { name: "submit" } },
    });
    calls.push(r.call);
    return { data: parseResult(spec.schema, r, true), calls, reasoning: r.reasoning, via: "tool" };
  } catch (e) {
    if (e instanceof ModelError) e.calls = calls;
    throw e;
  }
}
