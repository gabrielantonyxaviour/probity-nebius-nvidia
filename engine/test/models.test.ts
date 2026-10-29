import { describe, expect, it } from "vitest";
import { z } from "zod";
import { chat, ModelError, stripThinking } from "../src/models/client";
import { costUsd } from "../src/models/prices";
import { callJson, extractJson } from "../src/models/structured";

const ok = (content: string, usage = { prompt_tokens: 1000, completion_tokens: 200, prompt_tokens_details: { cached_tokens: 400 } }, extra: object = {}) =>
  new Response(JSON.stringify({ id: "chatcmpl-1", choices: [{ finish_reason: "stop", message: { content, ...extra } }], usage }), { status: 200 });

const base = { model: "nvidia/Nemotron-3_5-Lightning" as const, thinking: false, agent: "screen" as const, stepKey: "screen", maxTokens: 100, messages: [{ role: "user" as const, content: "hi" }] };

describe("cost", () => {
  it("bills cached tokens at the cached rate", () => {
    // 600 fresh * $1.00 + 400 cached * $0.12 + 200 out * $3.00 per 1M
    expect(costUsd("nvidia/Nemotron-3-Ultra-550b-a55b", { promptTokens: 1000, cachedTokens: 400, completionTokens: 200 })).toBeCloseTo(0.001248, 9);
    expect(costUsd("nvidia/Nemotron-3_5-Lightning", { promptTokens: 1_000_000, cachedTokens: 0, completionTokens: 1_000_000 })).toBeCloseTo(0.3, 9);
    expect(costUsd("nvidia/Nemotron-3.5-Super-VL", { promptTokens: 1000, cachedTokens: 5000, completionTokens: 0 })).toBeCloseTo(0.00006, 9);
  });
});

describe("client", () => {
  it("records usage, cached tokens, cost, response id and tool names", async () => {
    const fetchImpl = (async () => new Response(JSON.stringify({ id: "chatcmpl-9", choices: [{ finish_reason: "tool_calls", message: { content: "", tool_calls: [{ id: "t1", function: { name: "vendor_master", arguments: "{}" } }] } }], usage: { prompt_tokens: 100, completion_tokens: 10, prompt_tokens_details: { cached_tokens: 50 } } }), { status: 200 })) as typeof fetch;
    const r = await chat({ NEBIUS_API_KEY: "k", fetchImpl }, base);
    expect(r.call).toMatchObject({ requestId: "chatcmpl-9", promptTokens: 100, cachedTokens: 50, completionTokens: 10, toolCalls: ["vendor_master"], thinking: false });
    expect(r.call.costUsd).toBeCloseTo((50 * 0.06 + 50 * 0.03 + 10 * 0.24) / 1e6, 10);
  });
  it("retries 429 and 5xx, but not 400", async () => {
    let n = 0;
    const flaky = (async () => (++n < 3 ? new Response("busy", { status: n === 1 ? 429 : 503 }) : ok("fine"))) as typeof fetch;
    expect((await chat({ NEBIUS_API_KEY: "k", fetchImpl: flaky }, base)).content).toBe("fine");
    expect(n).toBe(3);
    let m = 0;
    const bad = (async () => (++m, new Response("nope", { status: 400 }))) as typeof fetch;
    await expect(chat({ NEBIUS_API_KEY: "k", fetchImpl: bad }, base)).rejects.toBeInstanceOf(ModelError);
    expect(m).toBe(1);
  });
  it("strips inline reasoning", () => {
    expect(stripThinking("<think>hmm</think>{\"a\":1}")).toBe('{"a":1}');
    expect(stripThinking("reasoning...</think>answer")).toBe("answer");
  });
});

describe("structured output", () => {
  const schema = z.object({ n: z.number() });
  it("uses response_format first and parses fenced JSON", async () => {
    const seen: Array<Record<string, unknown>> = [];
    const fetchImpl = (async (_u: string, init: RequestInit) => (seen.push(JSON.parse(String(init.body))), ok('```json\n{"n": 3}\n```'))) as unknown as typeof fetch;
    const r = await callJson({ NEBIUS_API_KEY: "k", fetchImpl }, base, { name: "x", schema });
    expect(r.data).toEqual({ n: 3 });
    expect(r.via).toBe("schema");
    expect(seen[0]!.response_format).toMatchObject({ type: "json_schema", json_schema: { strict: true } });
    expect((seen[0]!.chat_template_kwargs as { enable_thinking: boolean }).enable_thinking).toBe(false);
  });
  it("falls back to a forced submit tool call on a 400, and on an answer that does not validate", async () => {
    for (const first of [new Response("unsupported", { status: 400 }), ok('{"n":"three"}')]) {
      const bodies: Array<Record<string, unknown>> = [];
      let k = 0;
      const fetchImpl = (async (_u: string, init: RequestInit) => {
        bodies.push(JSON.parse(String(init.body)));
        return ++k === 1 ? first.clone() : ok("", undefined, { tool_calls: [{ id: "t", function: { name: "submit", arguments: '{"n": 7}' } }] });
      }) as unknown as typeof fetch;
      const r = await callJson({ NEBIUS_API_KEY: "k", fetchImpl }, base, { name: "x", schema });
      expect(r.data).toEqual({ n: 7 });
      expect(r.via).toBe("tool");
      expect(bodies[1]!.tool_choice).toEqual({ type: "function", function: { name: "submit" } });
    }
  });
  it("extracts the first balanced object", () => {
    expect(extractJson('Sure! {"a": {"b": "}"}} trailing')).toEqual({ a: { b: "}" } });
    expect(() => extractJson("no json")).toThrow(ModelError);
  });
});
