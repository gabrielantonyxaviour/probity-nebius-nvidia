import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { newRun } from "../src/check/run";
import { logOutcome } from "../src/check/outcome";
import { fileRoutes } from "../src/routes/files";
import { inboxRoutes } from "../src/routes/inbox";
import { runRoutes } from "../src/routes/runs";
import type { AppEnv } from "../src/routes/util";
import type { Env } from "../src/env";
import { makeTenantEnv } from "./db";

function setup() {
  const env = makeTenantEnv({ seed: true });
  const files = new Map<string, string>([
    ["BCR-2026-0412.letter.pdf", "demo"],
    ["orgs/org_acme/uploads/UPL-1/letter.pdf", "acme"],
    ["orgs/org_demo/uploads/UPL-9/letter.pdf", "visitor"],
    ["pages/run-acme/1.png", "page-acme"],
    ["pages/run-demo/1.png", "page-demo"],
  ]);
  (env as unknown as { FILES: unknown }).FILES = { get: async (k: string) => (files.has(k) ? { body: files.get(k) } : null) };
  const done = (id: string, requestId: string) => {
    const r = newRun({ id, requestId, vendorName: "Booz Allen Hamilton Inc", live: true });
    r.status = "done";
    r.decision = { verdict: "CALLBACK_VERIFY", finalVerdict: "CALLBACK_VERIFY", reasons: [], rationale: "x", rationaleChecked: true, callCard: { phone: null, sources: [], letterPhones: [], ask: [] }, policyVersion: "p", outcome: null };
    return r;
  };
  const q = (sql: string, ...a: unknown[]) => env.DB.prepare(sql).bind(...a).run();
  return { env, done, q };
}
const app = (env: Env, org: string, sid = "sid-visitor-1") => {
  const a = new Hono<AppEnv>();
  a.use("*", async (c, next) => (c.set("orgId", org), c.set("userId", null), c.set("sid", sid), next()));
  a.route("/", inboxRoutes);
  a.route("/", runRoutes);
  a.route("/", fileRoutes);
  return { fetch: (path: string, init?: RequestInit) => a.request(path, init, env) };
};

describe("tenancy", async () => {
  const { env: fake, done, q } = setup();
  const env = fake as unknown as Env;
  // A second company with one request, one finished run and one upload.
  await q("INSERT INTO requests (id, vendor_id, kind, received_at, sender_email, amount_cents, next_run_at, status, synthetic, letter_key, eml_key, json, org_id, source) VALUES ('REQ-ACME-1', 'V-10027', 'bank_change', '2026-10-30T01:00:00Z', 'a@acme.example', 100, NULL, 'checked', 0, 'orgs/org_acme/uploads/UPL-1/letter.pdf', NULL, '{\"email\":{\"from\":\"a@acme.example\",\"subject\":\"s\"}}', 'org_acme', 'gmail')");
  const acmeRun = done("run-acme", "REQ-ACME-1");
  await q("INSERT INTO runs (id, request_id, status, live, json, created_at, updated_at, org_id) VALUES ('run-acme', 'REQ-ACME-1', 'done', 1, ?1, 'x', 'x', 'org_acme')", JSON.stringify(acmeRun));
  const demoRun = done("run-demo", "BCR-2026-0412");
  await q("INSERT INTO runs (id, request_id, status, live, json, created_at, updated_at) VALUES ('run-demo', 'BCR-2026-0412', 'done', 1, ?1, 'x', 'x')", JSON.stringify(demoRun));
  await q("INSERT INTO requests (id, vendor_id, kind, received_at, sender_email, amount_cents, next_run_at, status, synthetic, letter_key, eml_key, json, org_id, source, session_id) VALUES ('UPL-9', 'V-10027', 'bank_change', '2026-10-30T02:00:00Z', 'v@x.example', 1, NULL, 'unchecked', 0, 'orgs/org_demo/uploads/UPL-9/letter.pdf', NULL, '{\"email\":{\"from\":\"v@x.example\",\"subject\":\"s\"}}', 'org_demo', 'upload', 'sid-visitor-1')");

  const E = env;
  const ids = async (a: ReturnType<typeof app>) => ((await (await a.fetch("/api/inbox")).json()) as Array<{ requestId: string }>).map((i) => i.requestId);

  it("an inbox shows only its own company's requests", async () => {
    expect(await ids(app(env, "org_acme"))).toEqual(["REQ-ACME-1"]);
    const demo = await ids(app(env, "org_demo"));
    expect(demo).toContain("BCR-2026-0412");
    expect(demo).not.toContain("REQ-ACME-1");
  });
  it("carries the request's source", async () => {
    const items = (await (await app(env, "org_acme").fetch("/api/inbox")).json()) as Array<{ source: string }>;
    expect(items[0]!.source).toBe("gmail");
    const demo = (await (await app(env, "org_demo").fetch("/api/inbox")).json()) as Array<{ requestId: string; source: string }>;
    expect(demo.find((i) => i.requestId === "BCR-2026-0412")!.source).toBe("seed");
  });
  it("a visitor's upload into the demo company is visible to that visitor only", async () => {
    expect(await ids(app(env, "org_demo", "sid-visitor-1"))).toContain("UPL-9");
    expect(await ids(app(env, "org_demo", "sid-someone-else"))).not.toContain("UPL-9");
    expect((await app(env, "org_demo", "sid-someone-else").fetch("/api/requests/UPL-9")).status).toBe(404);
  });
  it("request details, runs and files of another company are 404, the demo company is readable by everyone", async () => {
    const acme = app(env, "org_acme");
    const other = app(env, "org_other", "sid-other");
    expect((await acme.fetch("/api/requests/REQ-ACME-1")).status).toBe(200);
    expect((await other.fetch("/api/requests/REQ-ACME-1")).status).toBe(404);
    expect((await other.fetch("/api/runs/run-acme")).status).toBe(404);
    expect((await acme.fetch("/api/runs/run-acme")).status).toBe(200);
    expect((await other.fetch("/api/runs/run-demo")).status).toBe(200);
    expect((await other.fetch("/api/requests/BCR-2026-0412")).status).toBe(200);
    expect((await other.fetch("/api/files/orgs/org_acme/uploads/UPL-1/letter.pdf")).status).toBe(404);
    expect((await acme.fetch("/api/files/orgs/org_acme/uploads/UPL-1/letter.pdf")).status).toBe(200);
    expect((await other.fetch("/api/files/pages/run-acme/1.png")).status).toBe(404);
    expect((await other.fetch("/api/files/pages/run-demo/1.png")).status).toBe(200);
    expect((await other.fetch("/api/files/BCR-2026-0412.letter.pdf")).status).toBe(200);
    expect((await other.fetch("/api/files/orgs/org_demo/uploads/UPL-9/letter.pdf")).status).toBe(404);
    expect((await app(env, "org_demo", "sid-visitor-1").fetch("/api/files/orgs/org_demo/uploads/UPL-9/letter.pdf")).status).toBe(200);
  });
  it("an outcome can only be logged by the company that owns the run, and a recorded demo run is not changed", async () => {
    expect(await logOutcome(E, "org_other", "run-acme", "confirmed", "AP clerk")).toEqual({ ok: false, code: "not_found" });
    const ok = await logOutcome(E, "org_acme", "run-acme", "confirmed", "AP clerk");
    expect(ok).toMatchObject({ ok: true, stored: true });
    if (ok.ok) expect(ok.run.decision!.finalVerdict).toBe("APPROVE");
    const row = await fake.DB.prepare("SELECT outcome, status FROM requests WHERE id = 'REQ-ACME-1'").first<{ outcome: string; status: string }>();
    expect(row).toEqual({ outcome: "confirmed", status: "closed" });
    await q("UPDATE runs SET live = 0 WHERE id = 'run-demo'");
    const rec = await logOutcome(E, "org_other", "run-demo", "denied", "Slack");
    expect(rec).toMatchObject({ ok: true, stored: false });
    const after = await fake.DB.prepare("SELECT json FROM runs WHERE id = 'run-demo'").first<{ json: string }>();
    expect(JSON.parse(after!.json).decision.outcome).toBeNull();
  });
  it("refuses an outcome on a run that has not finished", async () => {
    await q("INSERT INTO runs (id, request_id, status, live, json, created_at, updated_at, org_id) VALUES ('run-wip', 'REQ-ACME-1', 'running', 1, ?1, 'x', 'x', 'org_acme')", JSON.stringify(newRun({ id: "run-wip", requestId: "REQ-ACME-1", vendorName: "x", live: true })));
    expect(await logOutcome(E, "org_acme", "run-wip", "confirmed", "AP clerk")).toEqual({ ok: false, code: "not_finished" });
  });
});
