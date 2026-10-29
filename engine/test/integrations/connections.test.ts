import { afterEach, describe, expect, it, vi } from "vitest";
import { appFor, makeEnv, path, stubFetch } from "./harness";

afterEach(() => vi.unstubAllGlobals());
const composio = (extra: Array<(u: URL, i: RequestInit | undefined, b: any) => unknown> = []) => stubFetch([
  (u, i) => (path(u) === "/webhook_subscriptions" && (i?.method ?? "GET") === "GET" ? { items: [] } : undefined),
  (u, i) => (path(u) === "/webhook_subscriptions" && i?.method === "POST" ? { id: "ws_1", secret: "whsec_test", webhook_url: "x", enabled_events: [] } : undefined),
  (u, i) => (path(u) === "/tool_router/session" && i?.method === "POST" ? { session_id: "sess_1" } : undefined),
  (u) => (path(u) === "/tool_router/session/sess_1/link" ? { redirect_url: "https://connect.composio.dev/link/ln_1", connected_account_id: "ca_1", link_token: "t" } : undefined),
  ...extra,
]);

describe("connections", () => {
  it("lists all four providers as not connected for a new company", async () => {
    const env = makeEnv({ seed: true });
    const r = await appFor("org_acme").request("/api/connections", {}, env as never);
    const list = (await r.json()) as Array<{ provider: string; status: string }>;
    expect(list.map((c) => `${c.provider}:${c.status}`)).toEqual(["gmail:not_connected", "outlook:not_connected", "xero:not_connected", "slack:not_connected"]);
  });

  it("start gmail: registers the webhook once, makes a connect link, stores the attempt and a pending row", async () => {
    const env = makeEnv({ seed: true });
    const log = composio();
    const r = await appFor("org_acme").request("/api/connections/gmail/start", { method: "POST" }, env as never);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { redirectUrl: string }).redirectUrl).toBe("https://connect.composio.dev/link/ln_1");
    const link = log.find((l) => l.url.endsWith("/link"));
    expect(link?.body.toolkit).toBe("gmail");
    expect(link?.body.callback_url).toMatch(/^https:\/\/probity\.test\/api\/connections\/callback\?a=[0-9a-f-]{36}$/);
    expect(log.find((l) => l.url.endsWith("/tool_router/session"))?.body.user_id).toBe("org_acme");
    const secret = await env.d1.prepare("SELECT value FROM settings WHERE key = 'composio_webhook_secret'").first<{ value: string }>();
    expect(secret?.value).toBeTruthy();
    expect(secret?.value).not.toContain("whsec_test"); // sealed, not plain
    const list = (await (await appFor("org_acme").request("/api/connections", {}, env as never)).json()) as Array<{ provider: string; status: string }>;
    expect(list.find((c) => c.provider === "gmail")?.status).toBe("pending");
  });

  it("callback: checks the account id, reads the mailbox address, starts watching mail, redirects to settings", async () => {
    const env = makeEnv({ seed: true });
    composio();
    await appFor("org_acme").request("/api/connections/gmail/start", { method: "POST" }, env as never);
    const attempt = (await env.d1.prepare("SELECT id FROM connection_attempts").first<{ id: string }>())!.id;
    const log = stubFetch([
      (u) => (path(u) === "/connected_accounts/ca_1" ? { id: "ca_1", status: "ACTIVE", user_id: "org_acme", toolkit: { slug: "gmail" } } : undefined),
      (u) => (path(u) === "/tools/execute/GMAIL_GET_PROFILE" ? { successful: true, data: { response_data: { emailAddress: "ap@acme.test" } } } : undefined),
      (u) => (path(u) === "/trigger_instances/GMAIL_NEW_GMAIL_MESSAGE/upsert" ? { trigger_id: "ti_1" } : undefined),
    ]);
    const r = await appFor("org_acme").request(`/api/connections/callback?a=${attempt}&status=success&connected_account_id=ca_1`, {}, env as never);
    expect(r.status).toBe(302);
    expect(r.headers.get("location")).toBe("/settings?connected=gmail");
    expect(log.find((l) => l.url.includes("/upsert"))?.body).toMatchObject({ user_id: "org_acme", connected_account_id: "ca_1" });
    const row = await env.d1.prepare("SELECT status, account, trigger_id FROM connections WHERE org_id = 'org_acme' AND provider = 'gmail'").first<Record<string, string>>();
    expect(row).toMatchObject({ status: "connected", account: "ap@acme.test", trigger_id: "ti_1" });
    // the attempt is single use
    expect((await appFor("org_acme").request(`/api/connections/callback?a=${attempt}&status=success&connected_account_id=ca_1`, {}, env as never)).headers.get("location")).toBe("/settings?error=connection");
  });

  it("callback with a different account id is refused and marks the connection as an error", async () => {
    const env = makeEnv({ seed: true });
    composio();
    await appFor("org_acme").request("/api/connections/outlook/start", { method: "POST" }, env as never);
    const attempt = (await env.d1.prepare("SELECT id FROM connection_attempts").first<{ id: string }>())!.id;
    const r = await appFor("org_acme").request(`/api/connections/callback?a=${attempt}&status=success&connected_account_id=ca_OTHER`, {}, env as never);
    expect(r.headers.get("location")).toBe("/settings?error=outlook");
    expect((await env.d1.prepare("SELECT status FROM connections WHERE provider = 'outlook'").first<{ status: string }>())?.status).toBe("error");
  });

  it("only owners and admins of a real company can connect; the demo is read-only", async () => {
    const env = makeEnv({ seed: true });
    composio();
    expect((await appFor("org_demo", "viewer").request("/api/connections/gmail/start", { method: "POST" }, env as never)).status).toBe(403);
    expect((await appFor("org_acme", "member").request("/api/connections/gmail/start", { method: "POST" }, env as never)).status).toBe(403);
    expect((await appFor("org_acme", "admin").request("/api/connections/gmail/start", { method: "POST" }, env as never)).status).toBe(200);
    expect((await appFor("org_acme", "owner").request("/api/connections/nope/start", { method: "POST" }, env as never)).status).toBe(400);
  });

  it("xero uses our own app: a custom auth config is created and passed to the session", async () => {
    const env = makeEnv({ seed: true });
    const log = composio([
      (u) => (path(u) === "/auth_configs" && u.search.includes("toolkit_slug=xero") ? { items: [] } : undefined),
      (u, i) => (path(u) === "/auth_configs" && i?.method === "POST" ? { auth_config: { id: "ac_xero" } } : undefined),
    ]);
    await appFor("org_acme").request("/api/connections/xero/start", { method: "POST" }, env as never);
    const ac = log.find((l) => l.method === "POST" && l.url.endsWith("/auth_configs"));
    expect(ac?.body.auth_config).toMatchObject({ type: "use_custom_auth", credentials: { client_id: "xero-id", client_secret: "xero-secret" } });
    expect(log.find((l) => l.url.endsWith("/tool_router/session"))?.body.auth_configs).toEqual({ xero: "ac_xero" });
  });

  it("disconnect removes the trigger and the Composio account, then the row", async () => {
    const env = makeEnv({ seed: true });
    env.d1.exec("INSERT INTO connections (org_id, provider, status, account, connected_account_id, trigger_id, updated_at) VALUES ('org_acme','gmail','connected','ap@acme.test','ca_1','ti_1','2026-10-30T00:00:00Z')");
    const log = stubFetch([(u, i) => (i?.method === "DELETE" ? {} : undefined)]);
    const r = await appFor("org_acme").request("/api/connections/gmail/disconnect", { method: "POST" }, env as never);
    expect(r.status).toBe(200);
    expect(log.map((l) => l.url)).toEqual(expect.arrayContaining([expect.stringContaining("/trigger_instances/manage/ti_1"), expect.stringContaining("/connected_accounts/ca_1")]));
    expect(await env.d1.prepare("SELECT 1 FROM connections WHERE provider = 'gmail'").first()).toBeNull();
  });

  it("without a Composio key a mail connection answers not_configured, never an error page", async () => {
    const env = makeEnv({ seed: true });
    (env as { COMPOSIO_API_KEY: string }).COMPOSIO_API_KEY = "";
    const r = await appFor("org_acme").request("/api/connections/gmail/start", { method: "POST" }, env as never);
    expect(r.status).toBe(503);
    expect(((await r.json()) as { code: string }).code).toBe("not_configured");
  });
});
