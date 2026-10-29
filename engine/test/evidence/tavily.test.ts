import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { tavilyContact } from "../../src/evidence";
import { extractPhones, isAggregator, pickContactPage, pickDomain } from "../../src/evidence/tavily";
import { getLimits } from "../../src/ops/guard";
import { makeEnv } from "./fake-env";

const dir = join(dirname(fileURLToPath(import.meta.url)), "recorded");
const rec = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), "utf8"));
const json = (b: unknown): Response => new Response(JSON.stringify(b), { status: 200, headers: { "Content-Type": "application/json" } });
// Recorded once from the live API (1 credit); the tests never call Tavily.
function stub() {
  const calls: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (u: string | URL | Request) => {
    const url = String(u);
    calls.push(url);
    return url.endsWith("/search") ? json(rec("tavily-search-booz.json")) : json(rec("tavily-extract-booz.json"));
  }));
  return calls;
}
afterEach(() => vi.unstubAllGlobals());

describe("tavily helpers", () => {
  it("rejects aggregators and picks the company's own domain", () => {
    expect(isAggregator("www.linkedin.com")).toBe(true);
    const picked = pickDomain("Booz Allen Hamilton Inc.", [{ url: "https://en.wikipedia.org/wiki/Booz_Allen_Hamilton" }, { url: "https://sossecinc.com/company/booz-allen-hamilton-inc" }, { url: "https://www.boozallen.com/menu/office-locations.html" }]);
    expect(picked?.host).toBe("boozallen.com");
    expect(pickContactPage("boozallen.com", [{ url: "https://www.boozallen.com/careers/x.html" }, { url: "https://www.boozallen.com/contact.html" }])).toContain("contact");
  });
  it("finds US phone numbers in many formats", () => {
    expect(extractPhones("Call 703-902-5000 or (703) 902-5000, fax +1 703.902.5001. Year 2026-10-30 is not a phone.")).toEqual(["(703) 902-5000", "(703) 902-5001"]);
  });
});

describe("tavilyContact", () => {
  it("a fresh lookup costs the reported credits, is recorded in D1 and returns phone, domain and snippets", async () => {
    const calls = stub();
    const env = makeEnv({ seed: true });
    const r = await tavilyContact(env, { company: "Booz Allen Hamilton Inc.", sessionId: "sess-aaaaaa" });
    expect(calls.map((c) => c.split("/").pop())).toEqual(["search", "extract"]);
    expect(r.creditsUsed).toBe(1);
    expect(r.evidence.find((e) => e.field === "domain")?.value).toBe("boozallen.com");
    expect(r.evidence.some((e) => e.field === "phone")).toBe(true);
    expect(r.snippets.length).toBeGreaterThan(0);
    expect(r.evidence.every((e) => e.source === "tavily" && !e.cached)).toBe(true);
    expect((await getLimits(env, "sess-aaaaaa")).tavilyCreditsUsed).toBe(1);
  });

  it("a cache hit costs 0 credits, makes no call and does not use a session lookup", async () => {
    const calls = stub();
    const env = makeEnv({ seed: true });
    await tavilyContact(env, { company: "Booz Allen Hamilton Inc.", sessionId: "sess-aaaaaa" });
    const n = calls.length;
    const again = await tavilyContact(env, { company: "booz allen hamilton inc", sessionId: "sess-bbbbbb" });
    expect(calls.length).toBe(n);
    expect(again.creditsUsed).toBe(0);
    expect(again.evidence.every((e) => e.cached)).toBe(true);
  });

  it("stops at the monthly budget with no call", async () => {
    const calls = stub();
    const env = makeEnv({ seed: true });
    env.d1.exec(`INSERT INTO usage VALUES ('${new Date().toISOString().slice(0, 7)}','*','tavily_credit',149)`);
    const r = await tavilyContact(env, { company: "Leidos Holdings", sessionId: "sess-aaaaaa" });
    expect(calls).toHaveLength(0);
    expect(r.summary).toContain("budget used up");
    expect(r.creditsUsed).toBe(0);
  });

  it("allows 3 new lookups per session, then refuses without a call", async () => {
    const calls = stub();
    const env = makeEnv({ seed: true });
    for (const c of ["Alpha Corp", "Beta Corp", "Gamma Corp"]) await tavilyContact(env, { company: c, sessionId: "sess-cccccc" });
    const before = calls.length;
    const fourth = await tavilyContact(env, { company: "Delta Corp", sessionId: "sess-cccccc" });
    expect(calls.length).toBe(before);
    expect(fourth.summary).toContain("3 new web lookups");
  });

  it("without a key it says so and spends nothing", async () => {
    const calls = stub();
    const env = makeEnv({ seed: true });
    env.TAVILY_API_KEY = "";
    const r = await tavilyContact(env, { company: "X", sessionId: "s-123456" });
    expect(calls).toHaveLength(0);
    expect(r.evidence).toEqual([]);
  });
});
