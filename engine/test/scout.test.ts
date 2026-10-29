import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Evidence, Run } from "@probity/shared";
import { newRun } from "../src/check/run";
import type { Ctx, RunStore, Scratch } from "../src/check/types";
import { ev } from "./helpers";

const calls: Array<{ name: string; args: unknown }> = [];
let webSnippets: string[] = ["Contact us: (321) 727-9100"];
let ledger: Evidence[] = [];

vi.mock("../src/evidence", async () => {
  const mk = (n: string) => async (_env: unknown, a: unknown) => (calls.push({ name: n, args: a }), { evidence: [], summary: `${n} done` });
  return {
    scoutTools: [{ type: "function", function: { name: "web_contact_lookup", parameters: {} } }],
    vendorMaster: mk("vendor_master"),
    lookupEdgar: mk("edgar_lookup"),
    lookupUsaspending: mk("usaspending_lookup"),
    lookupGleif: mk("gleif_lookup"),
    tavilyContact: async (_env: unknown, a: unknown) => {
      calls.push({ name: "web_contact_lookup", args: a });
      return { evidence: [ev("ev-tavily-ph0001", "tavily", "phone", "Phone on the official website", "(321) 727-9100")], summary: "web: (321) 727-9100", creditsUsed: 2, snippets: webSnippets };
    },
  };
});
vi.mock("../src/check/ledger", () => ({ ledgerEvidence: async () => ledger }));

const { scoutStage } = await import("../src/check/scoutstage");

function memoryStore(run: Run): RunStore {
  return { get: async () => structuredClone(run), update: async (_id, fn) => (fn(run), structuredClone(run)) };
}

/** Fake Token Factory: the scout model's script, and the screen's verdict on web snippets. */
function fakeFetch(scoutScript: Array<string[]>, flagWeb: boolean): typeof fetch {
  let round = 0;
  return (async (_u: string, init: RequestInit) => {
    const body = JSON.parse(String(init.body)) as { model: string };
    const usage = { prompt_tokens: 100, completion_tokens: 10 };
    if (body.model.includes("Lightning"))
      return new Response(JSON.stringify({ id: "s", choices: [{ message: { content: JSON.stringify({ flagged: flagWeb ? [{ id: 1, why: "addresses the reviewer" }] : [] }) } }], usage }));
    const names = scoutScript[round++] ?? [];
    return new Response(
      JSON.stringify({ id: "v", choices: [{ finish_reason: names.length ? "tool_calls" : "stop", message: { content: names.length ? "" : "done", tool_calls: names.map((n, k) => ({ id: `t${round}${k}`, function: { name: n, arguments: "{}" } })) } }], usage }),
    );
  }) as unknown as typeof fetch;
}

const scratch = (): Scratch =>
  ({
    request: { requestId: "BCR-2026-0412", vendorId: "V-10027", vendorName: "Booz Allen Hamilton Inc", kind: "bank_change", senderEmail: "x@y.example", amountAtRisk: { cents: 1, currency: "USD" }, nextRunAt: null, receivedAt: "2026-10-22T15:12:00Z", email: { from: "a@boozallen.example", replyTo: null, subject: "s", received: "x", spf: null, dkim: null }, vendorOnFile: { legalName: "Booz Allen Hamilton Inc", remitAddress: "", phone: null, domain: "boozallen.example", accountMasked: "••••0501" } },
    emlText: "", lines: [], letterPhones: [], withheld: [], claims: [], pressure: [], textAccount: null, readingsDisagree: [], examiner: null, pageKeys: [],
  }) as Scratch;

function setup(script: string[][], flagWeb = false) {
  const run = newRun({ id: "run-t", requestId: "BCR-2026-0412", vendorName: "Booz Allen Hamilton Inc", live: true });
  run.screen = { spansScreened: 10, flags: [] };
  const ctx = { env: { NEBIUS_API_KEY: "k", fetchImpl: fakeFetch(script, flagWeb) }, runId: "run-t", sessionId: "s1", store: memoryStore(run), files: {}, wasm: new Uint8Array() } as unknown as Ctx;
  return { ctx, run };
}

beforeEach(() => {
  calls.length = 0;
  webSnippets = ["Contact us: (321) 727-9100"];
  ledger = [];
});

describe("scout: the web lookup always happens", () => {
  it("is run by code, once, when the model never asks for it, and the step says so", async () => {
    const { ctx, run } = setup([["vendor_master", "edgar_lookup"], []]);
    const out = await scoutStage(ctx, scratch());
    expect(calls.filter((c) => c.name === "web_contact_lookup")).toHaveLength(1);
    expect(out.summary).toMatch(/web lookup run by code/);
    expect(run.evidence.map((e) => e.id)).toContain("ev-tavily-ph0001");
    expect(run.totals.tavilyCredits).toBe(2);
  });

  it("is not run a second time when the model already asked, and says nothing about code", async () => {
    const { ctx } = setup([["vendor_master", "edgar_lookup", "web_contact_lookup"], []]);
    const out = await scoutStage(ctx, scratch());
    expect(calls.filter((c) => c.name === "web_contact_lookup")).toHaveLength(1);
    expect(out.summary).not.toMatch(/by code/);
  });

  it("ignores a second web request from the model", async () => {
    const { ctx } = setup([["web_contact_lookup"], ["web_contact_lookup", "vendor_master"], []]);
    await scoutStage(ctx, scratch());
    expect(calls.filter((c) => c.name === "web_contact_lookup")).toHaveLength(1);
  });

  it("always searches for the vendor of record and its domain on file, whatever the model passes", async () => {
    const { ctx } = setup([["vendor_master"], []]);
    await scoutStage(ctx, scratch());
    expect(calls.find((c) => c.name === "web_contact_lookup")!.args).toMatchObject({ company: "Booz Allen Hamilton Inc", domainHint: "boozallen.example", sessionId: "s1" });
  });

  it("asks a registry when the model asked none", async () => {
    const { ctx } = setup([["vendor_master"], []]);
    await scoutStage(ctx, scratch());
    expect(calls.map((c) => c.name)).toEqual(expect.arrayContaining(["vendor_master", "edgar_lookup", "web_contact_lookup"]));
  });

  it("screens the snippets: flagged ones are recorded and no web fact is kept, but the credits are counted", async () => {
    const { ctx, run } = setup([["vendor_master", "edgar_lookup"], []], true);
    await scoutStage(ctx, scratch());
    expect(run.evidence.some((e) => e.source === "tavily")).toBe(false);
    expect(run.screen!.flags).toMatchObject([{ source: "web", by: "lightning" }]);
    expect(run.screen!.spansScreened).toBe(11);
    expect(run.totals.tavilyCredits).toBe(2);
  });

  it("keeps clean web facts and screens every snippet", async () => {
    const { ctx, run } = setup([["vendor_master", "edgar_lookup"], []]);
    await scoutStage(ctx, scratch());
    expect(run.screen!.flags).toEqual([]);
    expect(run.screen!.spansScreened).toBe(11);
  });
});
