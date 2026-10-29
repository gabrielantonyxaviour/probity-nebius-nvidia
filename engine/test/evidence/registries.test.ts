import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import { lookupEdgar, lookupGleif, lookupUsaspending } from "../../src/evidence";
import { makeEnv } from "./fake-env";

const dir = join(dirname(fileURLToPath(import.meta.url)), "recorded");
const rec = (f: string): unknown => JSON.parse(readFileSync(join(dir, f), "utf8"));
const json = (body: unknown, status = 200): Response => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function route(calls: Array<{ url: string; init?: RequestInit }>) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = String(input);
    calls.push({ url, init });
    if (url.endsWith("company_tickers.json")) return json(rec("edgar-tickers.json"));
    if (url.includes("CIK0001443646.json")) return json(rec("edgar-submission-0001443646.json"));
    if (url.includes("CIK0000202058.json")) return json(rec("edgar-submission-0000202058.json"));
    if (url.includes("api.usaspending.gov/api/v2/recipient/") && init?.method === "POST") return json(rec("usaspending-search-booz.json"));
    if (url.includes("api.usaspending.gov/api/v2/recipient/")) return json(rec("usaspending-profile-booz.json"));
    if (url.includes("gleif.org/api/v1/fuzzycompletions")) return json(rec("gleif-completions-booz.json"));
    if (url.includes("gleif.org/api/v1/lei-records/")) return json(rec("gleif-record-booz.json"));
    return json({}, 404);
  });
}

afterEach(() => vi.unstubAllGlobals());

describe("EDGAR", () => {
  it("resolves a name to the registrant and returns phone, address and former names with the declared User-Agent", async () => {
    const calls: Array<{ url: string; init?: RequestInit }> = [];
    vi.stubGlobal("fetch", route(calls));
    const env = makeEnv();
    const r = await lookupEdgar(env, { name: "Booz Allen Hamilton Inc." });
    const byField = Object.fromEntries(r.evidence.map((e) => [e.field, e]));
    expect(byField.phone?.value).toBe("(703) 902-5000");
    expect(byField.address?.value).toContain("8283 Greensboro Drive");
    expect(byField.legal_name?.value).toBe("Booz Allen Hamilton Holding Corp");
    expect(r.evidence.every((e) => e.source === "sec_edgar" && e.cached === false && e.url?.startsWith("https://www.sec.gov/"))).toBe(true);
    expect(r.summary.length).toBeLessThanOrEqual(1500);
    const sec = calls.filter((c) => c.url.includes("sec.gov"));
    expect(sec.length).toBeGreaterThan(0);
    for (const c of sec) expect((c.init?.headers as Record<string, string>)["User-Agent"]).toBe(env.SEC_USER_AGENT);
  });

  it("serves the second lookup from the KV cache and marks it cached", async () => {
    const calls: Array<{ url: string }> = [];
    vi.stubGlobal("fetch", route(calls));
    const env = makeEnv();
    await lookupEdgar(env, { name: "L3Harris Technologies, Inc." });
    const n = calls.length;
    const again = await lookupEdgar(env, { name: "L3Harris Technologies, Inc." });
    expect(calls.length).toBe(n);
    expect(again.evidence.length).toBeGreaterThan(0);
    expect(again.evidence.every((e) => e.cached)).toBe(true);
  });

  it("never throws: an unreachable source gives an empty result that says so", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    const r = await lookupEdgar(makeEnv(), { name: "Booz Allen Hamilton Inc." });
    expect(r.evidence).toEqual([]);
    expect(r.summary.toLowerCase()).toMatch(/no registrant|unavailable/);
  });

  it("says a private company is not a registrant instead of guessing a different one", async () => {
    vi.stubGlobal("fetch", route([]));
    const r = await lookupEdgar(makeEnv(), { name: "Kettle Point Data Cabling LLC" });
    expect(r.evidence).toEqual([]);
    expect(r.summary).toContain("Kettle Point");
  });
});

describe("USAspending and GLEIF", () => {
  it("USAspending returns UEI, address and parent with a public URL", async () => {
    vi.stubGlobal("fetch", route([]));
    const r = await lookupUsaspending(makeEnv(), { name: "Booz Allen Hamilton Inc." });
    expect(r.evidence.find((e) => e.field === "identifier")?.value).toMatch(/^[A-Z0-9]{12}$/);
    expect(r.evidence.find((e) => e.field === "address")).toBeTruthy();
    expect(r.evidence.every((e) => e.source === "usaspending" && e.url?.startsWith("https://www.usaspending.gov/"))).toBe(true);
  });

  it("GLEIF returns the LEI, legal and headquarters address", async () => {
    vi.stubGlobal("fetch", route([]));
    const r = await lookupGleif(makeEnv(), { name: "Booz Allen Hamilton Inc." });
    expect(r.evidence.find((e) => e.label.startsWith("Legal Entity Identifier"))?.value).toContain("549300D7XCH2480XU542");
    expect(r.evidence.find((e) => e.label.startsWith("Headquarters"))?.value).toContain("McLean");
    expect(r.summary).toContain("no phone");
  });

  it("both degrade to an unavailable summary on HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => json({}, 503)));
    const env = makeEnv();
    for (const r of [await lookupUsaspending(env, { name: "X Corp" }), await lookupGleif(env, { name: "X Corp" })]) {
      expect(r.evidence).toEqual([]);
      expect(r.summary).toContain("unavailable");
    }
    expect(env.kv.store.size).toBe(0); // failures are not cached
  });
});
