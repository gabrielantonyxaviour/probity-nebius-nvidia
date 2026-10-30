import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyRunFinished, slackStart, verifySlack } from "../../src/integrations/slack";
import { runBlocks } from "../../src/integrations/slack-blocks";
import { hmacHex, unseal } from "../../src/integrations/util";
import { appFor, makeEnv, stubFetch } from "./harness";

afterEach(() => vi.unstubAllGlobals());

const run = (over: Record<string, unknown> = {}) => ({
  id: "run-1", requestId: "BCR-2026-0412", vendorName: "Booz Allen Hamilton Inc", status: "done", live: true, startedAt: "2026-10-30T00:00:00Z", finishedAt: "2026-10-30T00:01:00Z", steps: [], calls: [], evidence: [], letter: null, screen: null, error: null,
  totals: { costUsd: 0, promptTokens: 0, cachedTokens: 0, completionTokens: 0, tavilyCredits: 0 },
  decision: { verdict: "HOLD", finalVerdict: "HOLD", reasons: [{ code: "R3", severity: "hold", text: "The letter's address is not the one on file.", evidenceIds: [] }, { code: "R5", severity: "callback", text: "The sender domain is a look-alike.", evidenceIds: [] }], rationale: "Hold.", rationaleChecked: true, policyVersion: "pp", outcome: null, callCard: { phone: "(703) 902-5000", sources: [{ evidenceId: "ev1", source: "sec_edgar", label: "SEC EDGAR" }], letterPhones: ["(703) 555-0147"], ask: [] } },
  ...over,
});

describe("slack", () => {
  it("builds the install URL with its scopes (public-channel posting included) and the callback", async () => {
    const env = makeEnv({ seed: true });
    const u = new URL(await slackStart(env as never, "org_acme", "u1"));
    expect(u.origin + u.pathname).toBe("https://slack.com/oauth/v2/authorize");
    expect(u.searchParams.get("scope")).toBe("chat:write,chat:write.public,incoming-webhook");
    expect(u.searchParams.get("redirect_uri")).toBe("https://probity.test/api/connections/callback");
    expect(u.searchParams.get("state")).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("the OAuth callback stores the channel and a sealed bot token, never the plain token", async () => {
    const env = makeEnv({ seed: true });
    const state = new URL(await slackStart(env as never, "org_acme", "u1")).searchParams.get("state")!;
    stubFetch([(u) => (u.pathname === "/api/oauth.v2.access" ? { ok: true, access_token: "xoxb-secret", team: { name: "Acme AP" }, incoming_webhook: { channel: "#ap-payments", channel_id: "C123" } } : undefined)]);
    const r = await appFor("org_acme").request(`/api/connections/callback?code=abc&state=${state}`, {}, env as never);
    expect(r.headers.get("location")).toBe("/settings?connected=slack");
    const row = await env.d1.prepare("SELECT account, meta FROM connections WHERE provider = 'slack'").first<{ account: string; meta: string }>();
    expect(row?.account).toBe("#ap-payments · Acme AP");
    expect(row?.meta).not.toContain("xoxb-secret");
    expect(await unseal("slack-secret", (JSON.parse(row!.meta) as { token: string }).token)).toBe("xoxb-secret");
  });

  it("a callback with an unknown state is refused", async () => {
    const env = makeEnv({ seed: true });
    expect((await appFor("org_acme").request("/api/connections/callback?code=abc&state=nope", {}, env as never)).headers.get("location")).toBe("/settings?error=slack");
  });

  it("the message shows verdict, amount, top reasons, the independent number with its source, the crossed-out number and three buttons", () => {
    const m = runBlocks(run() as never, { amountCents: 128455000, appUrl: "https://probity.test" });
    const text = JSON.stringify(m.blocks);
    expect(text).toContain("On hold: Booz Allen Hamilton Inc");
    expect(text).toContain("$1,284,550.00 at risk");
    expect(text).toContain("The letter's address is not the one on file.");
    expect(text).toContain("(703) 902-5000");
    expect(text).toContain("SEC EDGAR");
    expect(text).toContain("~(703) 555-0147~");
    expect(text).toContain("https://probity.test/app/r/BCR-2026-0412");
    const actions = (m.blocks.find((b) => b.type === "actions") as { elements: Array<{ value: string }> }).elements;
    expect(actions.map((a) => a.value)).toEqual(["confirmed", "denied", "no_answer"]);
    expect(JSON.stringify(runBlocks(run() as never, { amountCents: null, appUrl: "https://probity.test", resolved: "done" }).blocks)).not.toContain('"actions"');
  });

  it("notifyRunFinished posts to the channel, remembers the message and e-mails the notify list on HOLD", async () => {
    const env = makeEnv({ seed: true });
    env.d1.exec("UPDATE requests SET org_id = 'org_acme' WHERE id = 'BCR-2026-0412'");
    env.d1.prepare("INSERT INTO runs (id, request_id, status, live, json, created_at, updated_at, org_id) VALUES ('run-1','BCR-2026-0412','done',1,?1,'2026-10-30T00:00:00Z','2026-10-30T00:00:00Z','org_acme')").bind(JSON.stringify(run())).run();
    env.d1.prepare("INSERT INTO connections (org_id, provider, status, account, meta, updated_at) VALUES ('org_acme','slack','connected','#ap',?1,'2026-10-30T00:00:00Z')").bind(JSON.stringify({ teamName: "Acme", channelId: "C123", channelName: "#ap", token: await (await import("../../src/integrations/util")).seal("slack-secret", "xoxb-1") })).run();
    env.d1.exec("INSERT INTO schedules (org_id, timezone, runs_json, recheck_minutes_before, notify_emails_json, updated_at) VALUES ('org_acme','America/New_York','[]',120,'[\"ap@acme.test\"]','2026-10-30T00:00:00Z')");
    const mails: { to: string[]; subject: string; text: string }[] = [];
    Object.assign(env, { EMAIL: { send: async (m: (typeof mails)[number]) => { mails.push(m); return { messageId: "em_1" }; } }, EMAIL_FROM: "Probity <alerts@probity.test>" });
    const log = stubFetch([(u) => (u.pathname === "/api/chat.postMessage" ? { ok: true, ts: "1700000000.0001" } : undefined)]);
    await notifyRunFinished(env as never, "org_acme", "run-1");
    const post = log.find((l) => l.url.endsWith("/chat.postMessage"));
    expect(post?.body.channel).toBe("C123");
    expect((await env.d1.prepare("SELECT ts FROM slack_posts WHERE run_id = 'run-1'").first<{ ts: string }>())?.ts).toBe("1700000000.0001");
    const mail = mails[0];
    expect(mail?.to).toEqual(["ap@acme.test"]);
    expect(mail?.subject).toContain("Hold: Booz Allen Hamilton Inc");
    expect(mail?.text).toContain("(703) 902-5000");
  });

  it("verifies Slack request signatures", async () => {
    const body = "payload=%7B%7D";
    const sig = `v0=${await hmacHex("slack-signing", `v0:1000:${body}`)}`;
    expect(await verifySlack("slack-signing", "1000", sig, body, 1100)).toBe(true);
    expect(await verifySlack("slack-signing", "1000", sig, body + "x", 1100)).toBe(false);
    expect(await verifySlack("slack-signing", "1000", sig, body, 5000)).toBe(false);
  });

  it("the interactivity endpoint refuses an unsigned click", async () => {
    const env = makeEnv({ seed: true });
    const r = await appFor("org_acme").request("/api/hooks/slack/interact", { method: "POST", body: "payload=%7B%7D", headers: { "content-type": "application/x-www-form-urlencoded" } }, env as never);
    expect(r.status).toBe(401);
  });
});
