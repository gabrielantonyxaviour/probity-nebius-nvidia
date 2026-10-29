import { describe, expect, it } from "vitest";
import type { ModelCall } from "@probity/shared";
import { getLimits, guardLiveCheck, refundLiveCheck } from "../src/ops/guard";
import { BUDGET_STOP_USD, budgetReached, recordCalls, recordJobSpend, totalSpendUsd } from "../src/ops/spend";
import { makeTenantEnv } from "./db";

const call = (usd: number): ModelCall => ({ id: "mc-1", stepKey: "scout", agent: "registry_scout", model: "nvidia/Nemotron-3.5-Super-VL", thinking: false, startedAt: "x", ms: 1, promptTokens: 1, cachedTokens: 0, completionTokens: 1, costUsd: usd, requestId: null, toolCalls: [] });

describe("demo company caps", () => {
  it("gives a visitor session 3 live checks, then session_cap, without taking a day slot for the refusal", async () => {
    const env = makeTenantEnv();
    for (let i = 0; i < 3; i++) expect(await guardLiveCheck(env, "sess-a1b2c3")).toEqual({ ok: true });
    expect(await guardLiveCheck(env, "sess-a1b2c3")).toEqual({ ok: false, code: "session_cap" });
    const l = await getLimits(env, "sess-a1b2c3");
    expect(l.sessionChecksLeft).toBe(0);
    expect(l.liveChecksLeftToday).toBe(2);
  });
  it("caps all visitors together at 5 a day", async () => {
    const env = makeTenantEnv();
    for (let i = 0; i < 5; i++) expect(await guardLiveCheck(env, `sess-user-${i}`)).toEqual({ ok: true });
    expect(await guardLiveCheck(env, "sess-user-new")).toEqual({ ok: false, code: "cap_reached" });
    expect((await getLimits(env, "sess-user-new")).liveChecksLeftToday).toBe(0);
  });
  it("two requests cannot both take the last slot", async () => {
    const env = makeTenantEnv();
    for (let i = 0; i < 4; i++) await guardLiveCheck(env, `sess-user-${i}`);
    const r = await Promise.all([guardLiveCheck(env, "sess-x00001"), guardLiveCheck(env, "sess-x00002")]);
    expect(r.filter((x) => x.ok)).toHaveLength(1);
  });
  it("a refund hands the slot back", async () => {
    const env = makeTenantEnv();
    await guardLiveCheck(env, "sess-a1b2c3");
    await refundLiveCheck(env, "sess-a1b2c3");
    expect(await getLimits(env, "sess-a1b2c3")).toMatchObject({ liveChecksLeftToday: 5, liveChecksPerDay: 5, sessionChecksLeft: 3, stopped: false });
  });
  it("the kill switch refuses and shows in the limits", async () => {
    const env = makeTenantEnv();
    env.d1.exec("INSERT INTO settings VALUES ('stopped','1')");
    expect(await guardLiveCheck(env, "sess-a1b2c3")).toEqual({ ok: false, code: "stopped" });
    expect((await getLimits(env, "sess-a1b2c3")).stopped).toBe(true);
  });
});

describe("real companies", () => {
  it("are not held to the demo's daily and session caps", async () => {
    const env = makeTenantEnv();
    for (let i = 0; i < 12; i++) expect(await guardLiveCheck(env, "sess-same01", "org_acme")).toEqual({ ok: true });
    expect((await getLimits(env, "sess-same01")).liveChecksLeftToday).toBe(5);
  });
});

describe("spend stop", () => {
  it("starts at the $0.35 already spent", async () => {
    const env = makeTenantEnv();
    expect(await totalSpendUsd(env)).toBeCloseTo(0.35, 6);
    expect(await budgetReached(env)).toBe(false);
  });
  it("records every model call and every job estimate", async () => {
    const env = makeTenantEnv();
    await recordCalls(env, "org_demo", "run-1", [call(0.01), call(0.02), call(0)]);
    await recordJobSpend(env, 0.05, "sweep job");
    expect(await totalSpendUsd(env)).toBeCloseTo(0.35 + 0.01 + 0.02 + 0.05, 6);
    const n = await env.DB.prepare("SELECT COUNT(*) AS n FROM spend WHERE kind = 'token_factory'").first<{ n: number }>();
    expect(n!.n).toBe(2); // the free call leaves no row
  });
  it(`refuses every new live check at $${BUDGET_STOP_USD}, for the demo company and for real ones, and reports stopped`, async () => {
    const env = makeTenantEnv();
    await recordJobSpend(env, BUDGET_STOP_USD - 0.35, "test");
    expect(await budgetReached(env)).toBe(true);
    expect(await guardLiveCheck(env, "sess-a1b2c3")).toEqual({ ok: false, code: "budget_reached" });
    expect(await guardLiveCheck(env, "sess-a1b2c3", "org_acme")).toEqual({ ok: false, code: "budget_reached" });
    expect((await getLimits(env, "sess-a1b2c3")).stopped).toBe(true);
  });
  it("still allows checks just under the line", async () => {
    const env = makeTenantEnv();
    await recordJobSpend(env, BUDGET_STOP_USD - 0.36, "test");
    expect(await guardLiveCheck(env, "sess-a1b2c3")).toEqual({ ok: true });
  });
});
