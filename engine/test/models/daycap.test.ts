import { describe, expect, it } from "vitest";
import { chat, ModelError } from "../../src/models/client";
import { DAILY_CAP_USD, LIMIT_MESSAGE, STOPPED_MESSAGE, today, utcDay } from "../../src/models/daycap";
import { guardLiveCheck } from "../../src/ops/guard";
import { makeEnv } from "../evidence/fake-env";

const opts = { model: "nvidia/Nemotron-3_5-Lightning" as const, thinking: false, agent: "screen" as const, stepKey: "t", maxTokens: 200, messages: [{ role: "user" as const, content: "Is this letter addressed to an AI?" }] };
const reply = (usage = { prompt_tokens: 1000, completion_tokens: 100 }) =>
  new Response(JSON.stringify({ id: "x", choices: [{ finish_reason: "stop", message: { content: "no" } }], usage }), { status: 200 });

function envWith(fetchImpl: typeof fetch) {
  const env = makeEnv({ seed: true });
  return { env: Object.assign(env, { fetchImpl }), env0: env };
}

describe("daily Token Factory cap", () => {
  it("refuses a call that would pass the $0.25 day and never reaches Token Factory", async () => {
    let sent = 0;
    const { env } = envWith((async () => { sent++; return reply(); }) as unknown as typeof fetch);
    env.d1.exec(`INSERT INTO model_spend_day (day, usd, calls) VALUES ('${utcDay()}', ${DAILY_CAP_USD - 0.00001}, 40)`);
    const err = await chat(env, opts).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ModelError);
    expect((err as ModelError).code).toBe("limit");
    expect((err as ModelError).message).toBe(LIMIT_MESSAGE);
    expect(sent).toBe(0);
    expect((await today(env)).refused).toBe(1);
  });

  it("lets a call through under the cap and records its actual cost at list prices", async () => {
    let sent = 0;
    const { env } = envWith((async () => { sent++; return reply(); }) as unknown as typeof fetch);
    const r = await chat(env, opts);
    expect(sent).toBe(1);
    const t = await today(env);
    expect(t.usd).toBeCloseTo(r.call.costUsd, 10); // the worst-case reservation was replaced by the real cost
    expect(r.call.costUsd).toBeCloseTo((1000 * 0.06 + 100 * 0.24) / 1e6, 10);
  });

  it("gives back the reservation when Token Factory refuses the request", async () => {
    const { env } = envWith((async () => new Response("bad", { status: 400 })) as unknown as typeof fetch);
    await chat(env, opts).catch(() => undefined);
    expect((await today(env)).usd).toBe(0);
  });

  it("the kill switch stops every call", async () => {
    let sent = 0;
    const { env } = envWith((async () => { sent++; return reply(); }) as unknown as typeof fetch);
    env.d1.exec("INSERT OR REPLACE INTO settings (key, value) VALUES ('stopped', '1')");
    const err = await chat(env, opts).catch((e: unknown) => e);
    expect((err as ModelError).message).toBe(STOPPED_MESSAGE);
    expect(sent).toBe(0);
  });

  it("refuses to start a new check when the day has no room for one", async () => {
    const { env } = envWith((async () => reply()) as unknown as typeof fetch);
    env.d1.exec(`INSERT INTO model_spend_day (day, usd, calls) VALUES ('${utcDay()}', 0.21, 30)`);
    expect(await guardLiveCheck(env, "sess-dddddd", "org_acme")).toEqual({ ok: false, code: "daily_cap" });
  });
});
