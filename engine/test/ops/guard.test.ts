import { describe, expect, it } from "vitest";
import { getLimits, guardLiveCheck, refundLiveCheck } from "../../src/ops";
import { makeEnv } from "../evidence/fake-env";

describe("spend guard", () => {
  it("gives a session 3 live checks, then session_cap", async () => {
    const env = makeEnv();
    for (let i = 0; i < 3; i++) expect(await guardLiveCheck(env, "sess-a1b2c3")).toEqual({ ok: true });
    expect(await guardLiveCheck(env, "sess-a1b2c3")).toEqual({ ok: false, code: "session_cap" });
    const l = await getLimits(env, "sess-a1b2c3");
    expect(l.sessionChecksLeft).toBe(0);
    expect(l.liveChecksLeftToday).toBe(7); // the refused fourth attempt did not consume a day slot
  });

  it("caps all sessions together at 10 a day", async () => {
    const env = makeEnv();
    for (let i = 0; i < 10; i++) expect(await guardLiveCheck(env, `sess-user-${i}`)).toEqual({ ok: true });
    expect(await guardLiveCheck(env, "sess-user-new")).toEqual({ ok: false, code: "cap_reached" });
    expect((await getLimits(env, "sess-user-new")).liveChecksLeftToday).toBe(0);
  });

  it("the kill switch refuses every check and shows in the limits", async () => {
    const env = makeEnv();
    env.d1.exec("INSERT INTO settings VALUES ('stopped','1')");
    expect(await guardLiveCheck(env, "sess-a1b2c3")).toEqual({ ok: false, code: "stopped" });
    expect((await getLimits(env, "sess-a1b2c3")).stopped).toBe(true);
  });

  it("concurrent requests cannot both take the last slot", async () => {
    const env = makeEnv();
    for (let i = 0; i < 9; i++) await guardLiveCheck(env, `sess-user-${i}`);
    const results = await Promise.all([guardLiveCheck(env, "sess-x00001"), guardLiveCheck(env, "sess-x00002"), guardLiveCheck(env, "sess-x00003")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
  });

  it("a refund hands the slot back; limits report the tavily budget", async () => {
    const env = makeEnv();
    await guardLiveCheck(env, "sess-a1b2c3");
    await refundLiveCheck(env, "sess-a1b2c3");
    const l = await getLimits(env, "sess-a1b2c3");
    expect(l).toMatchObject({ liveChecksLeftToday: 10, liveChecksPerDay: 10, sessionChecksLeft: 3, tavilyCreditsUsed: 0, tavilyBudget: 150, stopped: false });
  });
});
