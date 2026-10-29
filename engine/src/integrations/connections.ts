// /connections: list, start (Composio connect link or Slack OAuth), callback, disconnect.
import { Hono } from "hono";
import { z } from "zod";
import { Provider, type Connection } from "@probity/shared";
import { requireAdmin } from "./access";
import { ComposioError, composioConfigured, createLink, createSession, deleteConnectedAccount, ensureCustomAuthConfig, getConnectedAccount } from "./composio";
import { appUrl, nowIso, type IntEnv } from "./env";
import { identify, unwatchMailbox, watchMailbox } from "./identity";
import { slackCallback, slackDisconnect, slackStart } from "./slack";
import { connectionList, deleteConn, getConn, saveConn } from "./store";
import { ensureComposioWebhook } from "./hooks";
import type { AppEnv } from "../routes/util";

export const connectionRoutes = new Hono<AppEnv>();
const XERO_SCOPES = "offline_access accounting.contacts.read accounting.invoices.read accounting.settings.read";
const MAIL = new Set(["gmail", "outlook"]);

const err = (c: Parameters<typeof requireAdmin>[0], status: 400 | 403 | 502 | 503, error: string, code: string) => c.json({ error, code }, status);

connectionRoutes.get("/connections", async (c) => c.json(await connectionList(c.env, c.get("orgId"))));

connectionRoutes.post("/connections/:provider/start", requireAdmin, async (c) => {
  const p = Provider.safeParse(c.req.param("provider"));
  if (!p.success) return err(c, 400, "Unknown connection.", "bad_provider");
  const env = c.env as IntEnv;
  const orgId = c.get("orgId");
  try {
    if (p.data === "slack") return c.json({ redirectUrl: await slackStart(env, orgId, c.get("userId")) });
    if (!composioConfigured(env)) return err(c, 503, "This connection is not available yet.", "not_configured");
    let authConfigs: Record<string, string> | undefined;
    if (p.data === "xero") {
      if (!env.XERO_CLIENT_ID || !env.XERO_CLIENT_SECRET) return err(c, 503, "Xero is not available yet.", "not_configured");
      authConfigs = { xero: await ensureCustomAuthConfig(env, "xero", "probity-xero", { client_id: env.XERO_CLIENT_ID, client_secret: env.XERO_CLIENT_SECRET, scopes: XERO_SCOPES }) };
    }
    if (MAIL.has(p.data)) await ensureComposioWebhook(env);
    const attempt = crypto.randomUUID();
    const session = await createSession(env, orgId, authConfigs);
    const link = await createLink(env, session, p.data, `${appUrl(env)}/api/connections/callback?a=${attempt}`);
    await env.DB.prepare("INSERT INTO connection_attempts (id, org_id, provider, user_id, connected_account_id, created_at) VALUES (?1,?2,?3,?4,?5,?6)").bind(attempt, orgId, p.data, c.get("userId"), link.connectedAccountId, nowIso()).run();
    await saveConn(env, orgId, p.data, { status: "pending", detail: "Waiting for you to finish signing in", connected_account_id: link.connectedAccountId });
    return c.json({ redirectUrl: link.redirectUrl });
  } catch (e) {
    return err(c, 502, e instanceof ComposioError ? "The connection service did not accept the request. Try again in a minute." : "Could not start the connection.", "connect_failed");
  }
});

const Callback = z.object({ a: z.string().optional(), status: z.string().optional(), connected_account_id: z.string().optional(), code: z.string().optional(), state: z.string().optional(), error: z.string().optional() });

connectionRoutes.get("/connections/callback", async (c) => {
  const env = c.env as IntEnv;
  const q = Callback.safeParse(c.req.query());
  const back = (key: "connected" | "error", provider: string) => c.redirect(`/settings?${key}=${provider}`, 302);
  if (!q.success) return c.redirect("/settings?error=connection", 302);
  if (q.data.state) return slackCallback(env, q.data, back);

  const row = q.data.a ? await env.DB.prepare("SELECT org_id, provider, connected_account_id, created_at FROM connection_attempts WHERE id = ?1").bind(q.data.a).first<{ org_id: string; provider: Provider; connected_account_id: string; created_at: string }>() : null;
  if (!row || Date.now() - Date.parse(row.created_at) > 30 * 60_000) return c.redirect("/settings?error=connection", 302);
  await env.DB.prepare("DELETE FROM connection_attempts WHERE id = ?1").bind(q.data.a).run();
  const provider = row.provider as "gmail" | "outlook" | "xero";
  // The callback's query is not proof of anything: the account id must be the one we were handed when the link was made.
  if (q.data.status !== "success" || q.data.connected_account_id !== row.connected_account_id) {
    await saveConn(env, row.org_id, provider, { status: "error", detail: "The sign-in was not completed" });
    return back("error", provider);
  }
  try {
    let acct = await getConnectedAccount(env, row.connected_account_id);
    for (let i = 0; i < 3 && acct.status !== "ACTIVE"; i++) {
      await new Promise((r) => setTimeout(r, 1000));
      acct = await getConnectedAccount(env, row.connected_account_id);
    }
    if (acct.status !== "ACTIVE") throw new ComposioError(`account ${acct.status}`, null);
    const who = await identify(env, provider, row.org_id, row.connected_account_id);
    const triggerId = MAIL.has(provider) ? await watchMailbox(env, provider, row.org_id, row.connected_account_id) : null;
    await saveConn(env, row.org_id, provider, { status: "connected", account: who?.account ?? null, detail: MAIL.has(provider) ? "Watching for new mail" : null, connected_account_id: row.connected_account_id, trigger_id: triggerId, meta: who?.meta ? JSON.stringify(who.meta) : null, connected_at: nowIso() });
    return back("connected", provider);
  } catch {
    await saveConn(env, row.org_id, provider, { status: "error", detail: "The account connected but could not be read. Try again." });
    return back("error", provider);
  }
});

connectionRoutes.post("/connections/:provider/disconnect", requireAdmin, async (c) => {
  const p = Provider.safeParse(c.req.param("provider"));
  if (!p.success) return err(c, 400, "Unknown connection.", "bad_provider");
  const env = c.env as IntEnv;
  const orgId = c.get("orgId");
  const row = await getConn(env, orgId, p.data);
  if (row) {
    if (p.data === "slack") await slackDisconnect(env, row);
    else {
      if (row.trigger_id) await unwatchMailbox(env, row.trigger_id).catch(() => undefined);
      if (row.connected_account_id) await deleteConnectedAccount(env, row.connected_account_id).catch(() => undefined);
    }
    await deleteConn(env, orgId, p.data);
  }
  return c.json((await connectionList(env, orgId)) satisfies Connection[]);
});
