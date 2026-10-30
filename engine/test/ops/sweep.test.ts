import { describe, expect, it, vi } from "vitest";
import { signRequest, verifyRequest } from "../../src/ops/hmac";
import { makeOpsRoutes } from "../../src/ops/routes";
import { latestSweep, type OpsEnv } from "../../src/ops/sweep";
import { sweepWork } from "../../src/ops/work";
import { makeEnv } from "../evidence/fake-env";

const SECRET = "test-secret";
const callback = (over: Record<string, unknown> = {}) => ({ sweepId: "", mode: "sweep", state: "completed", startedAt: "2026-10-30T18:00:00.000Z", finishedAt: "2026-10-30T18:03:10.000Z", requestsSwept: 2, recheckedRequestIds: [], flaggedRequestIds: ["BCR-2026-0407"], sweptRequestIds: ["BCR-2026-0407", "BCR-2026-0412"], nemo: { spansChecked: 5, flagged: 1, outputChecks: 0, outputBlocked: 0 }, eval: null, costUsd: 0.002, ...over });

async function call(app: ReturnType<typeof makeOpsRoutes>, env: unknown, method: string, path: string, body = "", sign = true) {
  const headers: Record<string, string> = {};
  if (sign) {
    const s = await signRequest(SECRET, method, `/api${path}`, body);
    headers["x-probity-timestamp"] = s.timestamp;
    headers["x-probity-signature"] = s.signature;
  }
  return app.request(`http://app.test/api${path}`, { method, headers, body: method === "GET" ? undefined : body }, env as never);
}
const mount = () => makeOpsRoutes();
// the app is mounted at /api in the engine; here we mount it the same way
import { Hono } from "hono";
const wrap = (): Hono => new Hono().route("/api", mount());

describe("HMAC", () => {
  it("accepts a fresh signature and rejects tampering, replay and a missing header", async () => {
    const s = await signRequest(SECRET, "POST", "/api/sweep/callback", '{"a":1}', 1000);
    expect(await verifyRequest(SECRET, "POST", "/api/sweep/callback", '{"a":1}', s.timestamp, s.signature, 1100)).toBe(true);
    expect(await verifyRequest(SECRET, "POST", "/api/sweep/callback", '{"a":2}', s.timestamp, s.signature, 1100)).toBe(false);
    expect(await verifyRequest(SECRET, "GET", "/api/sweep/callback", '{"a":1}', s.timestamp, s.signature, 1100)).toBe(false);
    expect(await verifyRequest(SECRET, "POST", "/api/sweep/callback", '{"a":1}', s.timestamp, s.signature, 5000)).toBe(false);
    expect(await verifyRequest(SECRET, "POST", "/api/sweep/callback", '{"a":1}', undefined, undefined, 1100)).toBe(false);
    expect(await verifyRequest("", "POST", "/x", "", "1", "x", 1)).toBe(false);
  });
  it("matches the Python signer in job/sweep.py (vector computed with hmac.new in Python)", async () => {
    const s = await signRequest(SECRET, "POST", "/api/sweep/callback", '{"a":1}', 1000);
    expect(s.signature).toBe("01f7d8e0818f6e1988061b3cfef3114a7af9853ae825f1e3e708139851850eae");
  });
});

describe("sweep endpoints", () => {
  it("job endpoints refuse unsigned requests with the error shape", async () => {
    const env = makeEnv({ seed: true });
    const r = await call(wrap() as never, env, "POST", "/sweep/callback", JSON.stringify(callback()), false);
    expect(r.status).toBe(401);
    expect(await r.json()).toEqual({ error: "Signature missing or invalid.", code: "unauthorized" });
    expect((await call(wrap() as never, env, "GET", "/sweep/work", "", false)).status).toBe(401);
  });

  it("callback stores the report, stamps swept_at, and /sweep/latest returns it", async () => {
    const env = makeEnv({ seed: true });
    const app = wrap() as never;
    const r = await call(app, env, "POST", "/sweep/callback", JSON.stringify(callback()));
    expect(r.status).toBe(200);
    const latest = (await (await call(app, env, "GET", "/sweep/latest", "", false)).json()) as { state: string; requestsSwept: number; nemo: { flagged: number }; eval: unknown };
    expect(latest).toMatchObject({ state: "completed", requestsSwept: 2, eval: null });
    const swept = await env.d1.prepare("SELECT id, swept_at FROM requests WHERE swept_at IS NOT NULL ORDER BY id").all<{ id: string; swept_at: string }>();
    expect(swept.results.map((x) => x.id)).toEqual(["BCR-2026-0407", "BCR-2026-0412"]);
  });

  it("accepts the signature in the query string when a proxy drops custom headers", async () => {
    const env = makeEnv({ seed: true });
    const body = JSON.stringify(callback());
    const s = await signRequest(SECRET, "POST", "/api/sweep/callback", body);
    const r = await wrap().request(`http://app.test/api/sweep/callback?pts=${s.timestamp}&psig=${s.signature}`, { method: "POST", body }, env as never);
    expect(r.status).toBe(200);
    const bad = await wrap().request(`http://app.test/api/sweep/callback?pts=${s.timestamp}&psig=${"0".repeat(64)}`, { method: "POST", body }, env as never);
    expect(bad.status).toBe(401);
  });

  it("a malformed report is a 400, not a 500", async () => {
    const r = await call(wrap() as never, makeEnv({ seed: true }), "POST", "/sweep/callback", JSON.stringify({ state: "weird" }));
    expect(r.status).toBe(400);
    expect(((await r.json()) as { code: string }).code).toBe("bad_request");
  });

  it("latest sweep with no eval borrows the newest earlier eval numbers", async () => {
    const env = makeEnv({ seed: true });
    const app = wrap() as never;
    const ev = { cases: 30, injected: 7, caught: 7, clean: 23, falseAlarms: 1 };
    await call(app, env, "POST", "/sweep/callback", JSON.stringify(callback({ sweepId: "e1", mode: "eval", startedAt: "2026-10-29T10:00:00.000Z", finishedAt: "2026-10-29T10:02:00.000Z", eval: ev, sweptRequestIds: [] })));
    await call(app, env, "POST", "/sweep/callback", JSON.stringify(callback({ sweepId: "s1" })));
    const latest = (await (await call(app, env, "GET", "/sweep/latest", "", false)).json()) as { jobId: string; eval: unknown; requestsSwept: number };
    expect(latest.jobId).toBe("s1");
    expect(latest.requestsSwept).toBe(2);
    expect(latest.eval).toEqual(ev);
  });

  it("no sweeps yet is null", async () => {
    expect(await latestSweep(makeEnv() as unknown as OpsEnv)).toBeNull();
  });

  it("/limits reflects the session's remaining checks", async () => {
    const env = makeEnv();
    const r = await wrap().request("http://app.test/api/limits", { headers: { "x-probity-session": "sess-abc123" } }, env);
    expect(await r.json()).toMatchObject({ liveChecksLeftToday: 5, sessionChecksLeft: 3, tavilyBudget: 600, stopped: false });
  });
});

describe("sweep work", () => {
  it("lists open requests with the letter's full text, hidden lines included, and the latest run's evidence", async () => {
    const env = makeEnv({ seed: true });
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const letter = readFileSync(join(__dirname, "../../../fixtures/requests/BCR-2026-0407/letter.pdf"));
    env.r2.store.set("BCR-2026-0407.letter.pdf", "x");
    (env.FILES as unknown as { get: unknown }).get = async () => ({ arrayBuffer: async () => letter.buffer.slice(letter.byteOffset, letter.byteOffset + letter.byteLength) });
    const run = JSON.stringify({ decision: { rationale: "Hold: the letter asks to pay Norfolk." }, evidence: [{ id: "ev-1", label: "Remit address on file", value: "7722 Alderwood Trl, Norfolk, VA" }], letter: { claims: [{ field: "bank_name", value: "Harborline Savings" }] } });
    env.d1.exec(`INSERT INTO runs (id, request_id, status, live, json, created_at, updated_at) VALUES ('run-1','BCR-2026-0407','done',1,'${run}','2026-10-29T00:00:00Z','2026-10-29T00:00:00Z'); UPDATE requests SET latest_run_id='run-1' WHERE id='BCR-2026-0407'`);
    const items = await sweepWork(env);
    expect(items).toHaveLength(16);
    const sable = items.find((i) => i.requestId === "BCR-2026-0407")!;
    expect(sable.spans.find((s) => s.source === "letter")?.text).toContain("Ignore all previous instructions");
    expect(sable.rationale).toContain("Norfolk");
    expect(sable.evidence.map((e) => e.label)).toContain("Claimed in the letter (bank_name)");
  });
});

describe("job spend", () => {
  it("the first terminal callback counts compute (from registration) plus the rails' token cost toward the budget; a retry does not", async () => {
    const env = makeEnv({ seed: true });
    const app = wrap() as never;
    env.d1.exec("INSERT INTO sweep_reports (job_id, json, created_at) VALUES ('aijob-cost1', '{\"jobId\":\"aijob-cost1\",\"sweepId\":\"sweep-cost0001\",\"mode\":\"sweep\",\"state\":\"starting\",\"startedAt\":\"2026-10-30T10:00:00.000Z\",\"finishedAt\":null,\"requestsSwept\":0,\"recheckedRequestIds\":[],\"nemo\":{\"spansChecked\":0,\"flagged\":0,\"outputChecks\":0,\"outputBlocked\":0},\"eval\":null,\"costUsd\":0}', '2026-10-30T10:00:00.000Z')");
    const report = JSON.stringify(callback({ sweepId: "sweep-cost0001", startedAt: "2026-10-30T10:01:30.000Z", finishedAt: "2026-10-30T11:00:00.000Z", tokenCostUsd: 0.0016 }));
    await call(app, env, "POST", "/sweep/callback", report);
    await call(app, env, "POST", "/sweep/callback", report); // retried delivery
    const rows = await env.d1.prepare("SELECT kind, usd, note FROM spend WHERE kind = 'nebius_job'").all<{ kind: string; usd: number; note: string }>();
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]!.kind).toBe("nebius_job");
    expect(rows.results[0]!.usd).toBeCloseTo(0.068 + 0.0016, 4); // one hour of cpu-d3 plus the rails
    expect(rows.results[0]!.note).toContain("aijob-cost1");
  });
});

describe("register", () => {
  it("an operator-started job is recorded under its real Nebius id and the callback lands on it", async () => {
    const env = makeEnv({ seed: true });
    const app = wrap() as never;
    const body = JSON.stringify({ sweepId: "sweep-ab12cd34", jobId: "aijob-real123", mode: "eval" });
    expect((await call(app, env, "POST", "/sweep/register", body)).status).toBe(200);
    expect((await call(app, env, "POST", "/sweep/register", body, false)).status).toBe(401);
    const starting = (await (await call(app, env, "GET", "/sweep/latest", "", false)).json()) as { jobId: string; state: string };
    expect(starting).toMatchObject({ jobId: "aijob-real123", state: "starting" });
    await call(app, env, "POST", "/sweep/callback", JSON.stringify(callback({ sweepId: "sweep-ab12cd34", mode: "eval", eval: { cases: 30, injected: 7, caught: 7, clean: 23, falseAlarms: 1 }, sweptRequestIds: [] })));
    const done = (await (await call(app, env, "GET", "/sweep/latest", "", false)).json()) as { jobId: string; state: string; eval: { caught: number } };
    expect(done).toMatchObject({ jobId: "aijob-real123", state: "completed" });
    expect(done.eval.caught).toBe(7);
  });
});
