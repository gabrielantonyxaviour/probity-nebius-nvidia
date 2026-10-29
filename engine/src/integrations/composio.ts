// Composio over REST (https://backend.composio.dev/api/v3.1). Plain fetch: no SDK, nothing to bundle.
// Our company id is the Composio user id, so a webhook's metadata.user_id is the tenant.
import { z } from "zod";
import type { IntEnv } from "./env";

const BASE = "https://backend.composio.dev/api/v3.1";

export class ComposioError extends Error {
  constructor(message: string, readonly status: number | null) {
    super(message);
  }
}

export const composioConfigured = (env: Pick<IntEnv, "COMPOSIO_API_KEY">): boolean => Boolean(env.COMPOSIO_API_KEY);

async function call(env: IntEnv, method: string, path: string, body?: unknown, ms = 25_000): Promise<unknown> {
  if (!env.COMPOSIO_API_KEY) throw new ComposioError("Composio is not configured.", null);
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      headers: { "x-api-key": env.COMPOSIO_API_KEY, "Content-Type": "application/json", Accept: "application/json", "User-Agent": "probity-engine/1.0" },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(ms),
    });
  } catch (e) {
    throw new ComposioError(`Composio did not answer (${e instanceof Error ? e.name : "network"}).`, null);
  }
  const text = await res.text();
  if (res.status === 204 || text === "") return {};
  let json: unknown;
  try { json = JSON.parse(text); } catch { json = null; }
  if (!res.ok) {
    const msg = (json as { error?: { message?: string }; message?: string } | null)?.error?.message ?? (json as { message?: string } | null)?.message ?? text.slice(0, 160);
    throw new ComposioError(`Composio ${res.status}: ${String(msg).slice(0, 200)}`, res.status);
  }
  return json;
}

const parse = <T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, v: unknown, what: string): T => {
  const r = schema.safeParse(v);
  if (!r.success) throw new ComposioError(`Composio sent an unexpected ${what}.`, null);
  return r.data;
};

export async function createSession(env: IntEnv, userId: string, authConfigs?: Record<string, string>): Promise<string> {
  const r = parse(z.object({ session_id: z.string() }), await call(env, "POST", "/tool_router/session", { user_id: userId, ...(authConfigs ? { auth_configs: authConfigs } : {}) }), "session");
  return r.session_id;
}

export async function createLink(env: IntEnv, sessionId: string, toolkit: string, callbackUrl: string): Promise<{ redirectUrl: string; connectedAccountId: string }> {
  const r = parse(z.object({ redirect_url: z.string(), connected_account_id: z.string() }), await call(env, "POST", `/tool_router/session/${encodeURIComponent(sessionId)}/link`, { toolkit, callback_url: callbackUrl }), "connect link");
  return { redirectUrl: r.redirect_url, connectedAccountId: r.connected_account_id };
}

const Account = z.object({ id: z.string(), status: z.string(), user_id: z.string().optional(), toolkit: z.object({ slug: z.string() }).optional() });
export type ConnectedAccount = z.infer<typeof Account>;
export const getConnectedAccount = async (env: IntEnv, id: string): Promise<ConnectedAccount> => parse(Account, await call(env, "GET", `/connected_accounts/${encodeURIComponent(id)}`), "account");
export const deleteConnectedAccount = async (env: IntEnv, id: string): Promise<void> => void (await call(env, "DELETE", `/connected_accounts/${encodeURIComponent(id)}`));

export async function upsertTrigger(env: IntEnv, slug: string, userId: string, connectedAccountId: string, config: Record<string, unknown>): Promise<string> {
  const r = parse(z.object({ trigger_id: z.string() }), await call(env, "POST", `/trigger_instances/${encodeURIComponent(slug)}/upsert`, { user_id: userId, connected_account_id: connectedAccountId, trigger_config: config }), "trigger");
  return r.trigger_id;
}
export const deleteTrigger = async (env: IntEnv, triggerId: string): Promise<void> => void (await call(env, "DELETE", `/trigger_instances/manage/${encodeURIComponent(triggerId)}`));

export type ToolResult = { successful: boolean; data: unknown; error: string | null };
export async function executeTool(env: IntEnv, slug: string, userId: string, connectedAccountId: string, args: Record<string, unknown>): Promise<ToolResult> {
  const r = parse(z.object({ successful: z.boolean().optional(), data: z.unknown().optional(), error: z.string().nullish() }), await call(env, "POST", `/tools/execute/${encodeURIComponent(slug)}`, { user_id: userId, connected_account_id: connectedAccountId, arguments: args }, 40_000), "tool result");
  return { successful: r.successful ?? !r.error, data: r.data, error: r.error ?? null };
}

/** Call any provider endpoint with the user's token (for what the tool catalogue lacks, e.g. a Xero contact note). */
export async function proxyExecute(env: IntEnv, p: { userId: string; connectedAccountId: string; endpoint: string; method: "GET" | "POST" | "PUT"; body?: unknown }): Promise<unknown> {
  const r = await call(env, "POST", "/tools/execute/proxy", { user_id: p.userId, connected_account_id: p.connectedAccountId, endpoint: p.endpoint, method: p.method, ...(p.body === undefined ? {} : { body: p.body }) }, 40_000);
  return (r as { data?: unknown }).data ?? r;
}

const Subs = z.object({ items: z.array(z.object({ id: z.string(), webhook_url: z.string(), enabled_events: z.array(z.string()).optional() })) });
const Created = z.object({ id: z.string(), secret: z.string().optional() });

/** One webhook per Composio project. Returns the signing secret only when this call created it. */
export async function ensureWebhook(env: IntEnv, url: string): Promise<{ id: string; secret: string | null }> {
  const events = ["composio.trigger.message", "composio.connected_account.expired"];
  const list = parse(Subs, await call(env, "GET", "/webhook_subscriptions"), "webhook list");
  const mine = list.items.find((s) => s.webhook_url === url);
  if (mine) return { id: mine.id, secret: null };
  const made = parse(Created, await call(env, "POST", "/webhook_subscriptions", { webhook_url: url, enabled_events: events, version: "V3" }), "webhook");
  return { id: made.id, secret: made.secret ?? null };
}

const AuthConfigs = z.object({ items: z.array(z.object({ id: z.string(), is_composio_managed: z.boolean().optional(), name: z.string().optional() })) });
/** The auth config for a toolkit that needs our own OAuth app (Xero). Created once; found by name afterwards. */
export async function ensureCustomAuthConfig(env: IntEnv, toolkit: string, name: string, credentials: Record<string, string>): Promise<string> {
  const found = parse(AuthConfigs, await call(env, "GET", `/auth_configs?toolkit_slug=${encodeURIComponent(toolkit)}&limit=50`), "auth configs").items.find((a) => a.name === name);
  if (found) return found.id;
  const made = parse(z.object({ auth_config: z.object({ id: z.string() }) }), await call(env, "POST", "/auth_configs", { toolkit: { slug: toolkit }, auth_config: { type: "use_custom_auth", name, authScheme: "OAUTH2", credentials } }), "auth config");
  return made.auth_config.id;
}

export async function rotateWebhookSecret(env: IntEnv, id: string): Promise<string> {
  const r = parse(z.object({ secret: z.string() }), await call(env, "POST", `/webhook_subscriptions/${encodeURIComponent(id)}/rotate_secret`), "webhook secret");
  return r.secret;
}
