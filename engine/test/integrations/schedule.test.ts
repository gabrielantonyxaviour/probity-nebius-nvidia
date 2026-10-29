import { afterEach, describe, expect, it, vi } from "vitest";
import { runDueRechecks } from "../../src/integrations/schedule";
import { cutoffAfter, nextRecheckAt, zonedToUtc } from "../../src/integrations/tz";
import { appFor, makeEnv, stubFetch } from "./harness";

afterEach(() => vi.unstubAllGlobals());
const FRIDAY = { weekday: 5, cutoff: "14:00" };

describe("time zones", () => {
  it("converts wall time to UTC across the November 2026 DST change", () => {
    expect(new Date(zonedToUtc(2026, 10, 30, 14, 0, "America/New_York")).toISOString()).toBe("2026-10-30T18:00:00.000Z"); // EDT
    expect(new Date(zonedToUtc(2026, 11, 6, 14, 0, "America/New_York")).toISOString()).toBe("2026-11-06T19:00:00.000Z"); // EST
    expect(new Date(zonedToUtc(2026, 11, 6, 14, 0, "Asia/Kuala_Lumpur")).toISOString()).toBe("2026-11-06T06:00:00.000Z");
  });
  it("the next re-check is the lead time before the next cut-off", () => {
    const s = { timezone: "America/New_York", runs: [FRIDAY], recheckMinutesBefore: 120 };
    expect(nextRecheckAt(s, Date.parse("2026-10-29T12:00:00Z"))).toBe("2026-10-30T16:00:00.000Z");
    // once that moment has passed, the following Friday (now EST: 14:00 = 19:00Z)
    expect(nextRecheckAt(s, Date.parse("2026-10-30T16:00:01Z"))).toBe("2026-11-06T17:00:00.000Z");
    expect(nextRecheckAt({ ...s, runs: [] })).toBeNull();
  });
  it("picks the earlier of two runs and names the cut-off for wording", () => {
    const s = { timezone: "America/New_York", runs: [FRIDAY, { weekday: 2, cutoff: "14:00" }], recheckMinutesBefore: 60 };
    expect(nextRecheckAt(s, Date.parse("2026-10-30T20:00:00Z"))).toBe("2026-11-03T18:00:00.000Z");
    expect(cutoffAfter(s, Date.parse("2026-10-30T16:00:00Z"))).toEqual({ weekday: "Friday", cutoff: "14:00" });
  });
});

const body = { timezone: "America/New_York", runs: [FRIDAY], recheckMinutesBefore: 120, notifyEmails: ["ap@acme.test"] };
const put = (app: ReturnType<typeof appFor>, env: unknown, b: unknown) => app.request("/api/schedule", { method: "PUT", body: JSON.stringify(b), headers: { "content-type": "application/json" } }, env as never);
const makePro = (env: ReturnType<typeof makeEnv>, org: string) => env.d1.exec(`INSERT INTO org_profile (org_id, plan, plan_status, plan_renews_at, created_at) VALUES ('${org}','pro','active','2099-01-01T00:00:00Z','2026-10-01T00:00:00Z')`);

describe("schedule routes", () => {
  it("GET returns defaults for a company with no schedule", async () => {
    const env = makeEnv({ seed: true });
    const s = (await (await appFor("org_acme").request("/api/schedule", {}, env as never)).json()) as { timezone: string; runs: unknown[]; nextRecheckAt: string | null };
    expect(s.timezone).toBe("America/New_York");
    expect(s.nextRecheckAt).toBeNull();
  });
  it("PUT needs the Pro plan, an admin and a real time zone", async () => {
    const env = makeEnv({ seed: true });
    expect((await put(appFor("org_acme"), env, body)).status).toBe(402);
    makePro(env, "org_acme");
    expect((await put(appFor("org_acme", "member"), env, body)).status).toBe(403);
    expect((await put(appFor("org_acme"), env, { ...body, timezone: "Mars/Olympus" })).status).toBe(400);
    expect((await put(appFor("org_acme"), env, { ...body, notifyEmails: ["not-an-email"] })).status).toBe(400);
    const r = await put(appFor("org_acme"), env, body);
    expect(r.status).toBe(200);
    const saved = (await r.json()) as { nextRecheckAt: string; runs: unknown[] };
    expect(saved.runs).toHaveLength(1);
    expect(Date.parse(saved.nextRecheckAt)).toBeGreaterThan(Date.now());
    expect(((await (await appFor("org_acme").request("/api/schedule", {}, env as never)).json()) as { notifyEmails: string[] }).notifyEmails).toEqual(["ap@acme.test"]);
  });
});

describe("runDueRechecks", () => {
  const seedDue = (env: ReturnType<typeof makeEnv>, org: string) => env.d1.exec(`INSERT INTO schedules (org_id, timezone, runs_json, recheck_minutes_before, notify_emails_json, enabled, next_recheck_at, updated_at) VALUES ('${org}','America/New_York','[{"weekday":5,"cutoff":"14:00"}]',120,'["ap@acme.test"]',1,'2026-10-30T16:00:00Z','2026-10-01T00:00:00Z')`);

  it("re-checks a due Pro company once: stores a report, advances the next window, e-mails the summary", async () => {
    const env = makeEnv({ seed: true });
    makePro(env, "org_acme");
    seedDue(env, "org_acme");
    const mails: { subject: string }[] = [];
    Object.assign(env, { EMAIL: { send: async (m: (typeof mails)[number]) => { mails.push(m); return { messageId: "em_1" }; } }, EMAIL_FROM: "Probity <alerts@probity.test>" });
    stubFetch([]);
    const now = Date.parse("2026-10-30T16:01:00Z");
    expect(await runDueRechecks(env as never, now)).toEqual({ ran: ["org_acme"], failed: [] });
    const next = await env.d1.prepare("SELECT next_recheck_at, last_recheck_at FROM schedules WHERE org_id = 'org_acme'").first<Record<string, string>>();
    expect(next?.next_recheck_at).toBe("2026-11-06T17:00:00.000Z");
    expect(mails[0]?.subject).toContain("payment run");
    expect(await env.d1.prepare("SELECT COUNT(*) AS n FROM sweep_reports").first<{ n: number }>()).toEqual({ n: 1 });
    expect(await runDueRechecks(env as never, now)).toEqual({ ran: [], failed: [] }); // not due again
  });

  it("skips companies on the free plan and the demo company, but still moves their window on", async () => {
    const env = makeEnv({ seed: true });
    seedDue(env, "org_free");
    seedDue(env, "org_demo");
    stubFetch([]);
    expect(await runDueRechecks(env as never, Date.parse("2026-10-30T16:01:00Z"))).toEqual({ ran: [], failed: [] });
    expect((await env.d1.prepare("SELECT next_recheck_at FROM schedules WHERE org_id = 'org_free'").first<{ next_recheck_at: string }>())?.next_recheck_at).toBe("2026-11-06T17:00:00.000Z");
  });
});
