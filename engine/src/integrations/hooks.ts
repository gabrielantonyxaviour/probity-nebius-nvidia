// POST /hooks/composio: new-mail triggers from Gmail and Outlook. Verify, de-duplicate, classify, then hand a vendor request to intake.
import { Hono } from "hono";
import { z } from "zod";
import type { IncomingEmail } from "../intake";
import type { AppEnv } from "../routes/util";
import { isBankChangeRequest } from "./classify";
import { ensureWebhook, rotateWebhookSecret } from "./composio";
import { appUrl, nowIso, type IntEnv } from "./env";
import { fetchIncoming, parseTriggerData } from "./messages";
import { getConn, listConns, saveConn } from "./store";
import { b64ToBytes, hmacBase64, seal, timingSafeEqual, unseal } from "./util";

export const hookRoutes = new Hono<AppEnv>();
const SECRET_KEY = "composio_webhook_secret";

/** One Composio webhook per project, pointed at this app. The signing secret is kept sealed in D1 (it is only shown once, at creation). */
export async function ensureComposioWebhook(env: IntEnv): Promise<void> {
  if (!env.COMPOSIO_API_KEY) return;
  const stored = await env.DB.prepare("SELECT value FROM settings WHERE key = ?1").bind(SECRET_KEY).first<{ value: string | null }>();
  if (stored?.value) return;
  const hook = await ensureWebhook(env, `${appUrl(env)}/api/hooks/composio`);
  const secret = hook.secret ?? (await rotateWebhookSecret(env, hook.id));
  await env.DB.prepare("INSERT INTO settings (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(SECRET_KEY, await seal(env.COMPOSIO_API_KEY, secret)).run();
}

/** Standard Webhooks: HMAC-SHA256 (base64) over `${id}.${timestamp}.${body}`, header "v1,<sig>" (possibly several), 5 minute tolerance. */
export async function verifyComposioSignature(secret: string, h: { id?: string | null; timestamp?: string | null; signature?: string | null }, body: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!h.id || !h.timestamp || !h.signature) return false;
  const ts = Number(h.timestamp);
  if (!Number.isFinite(ts) || Math.abs(nowSec - ts) > 300) return false;
  const keys: Uint8Array[] = [new TextEncoder().encode(secret)];
  if (secret.startsWith("whsec_")) { try { keys.push(b64ToBytes(secret.slice(6))); } catch { /* not base64 */ } }
  const given = h.signature.split(" ").map((s) => (s.includes(",") ? s.split(",")[1] ?? "" : s));
  for (const k of keys) {
    const mine = await hmacBase64(k, `${h.id}.${h.timestamp}.${body}`);
    if (given.some((g) => timingSafeEqual(g, mine))) return true;
  }
  return false;
}

const Event = z.object({ id: z.string().optional(), type: z.string(), metadata: z.object({ trigger_slug: z.string().optional(), connected_account_id: z.string().optional(), user_id: z.string().optional() }).passthrough().optional(), data: z.unknown().optional() }).passthrough();

const today = (): string => nowIso().slice(0, 10);
async function count(env: IntEnv, orgId: string, col: "seen" | "matched" | "ignored"): Promise<void> {
  await env.DB.prepare(`INSERT INTO intake_counters (org_id, day, ${col}) VALUES (?1, ?2, 1) ON CONFLICT(org_id, day) DO UPDATE SET ${col} = ${col} + 1`).bind(orgId, today()).run();
}

type IntakeFn = (env: IntEnv, mail: IncomingEmail) => Promise<unknown>;
async function loadIntake(): Promise<IntakeFn | null> {
  const mod = (await import("../intake")) as { intake?: IntakeFn };
  return typeof mod.intake === "function" ? mod.intake : null;
}

export type HookOutcome = "ignored" | "intake" | "queued" | "duplicate" | "failed" | "unknown";

/** Handles one verified trigger event. Returns what happened; never throws into the webhook response. */
export async function handleTrigger(env: IntEnv, ev: z.infer<typeof Event>, intakeFn?: IntakeFn | null): Promise<HookOutcome> {
  const orgId = ev.metadata?.user_id;
  const accountId = ev.metadata?.connected_account_id;
  const slug = ev.metadata?.trigger_slug ?? "";
  const source = slug.startsWith("GMAIL") ? "gmail" : slug.startsWith("OUTLOOK") ? "outlook" : null;
  if (!orgId || !accountId || !source) return "unknown";
  const conn = await getConn(env, orgId, source);
  if (!conn || conn.connected_account_id !== accountId) return "unknown";
  const parsed = parseTriggerData(source, ev.data);
  if (!parsed.messageId) return "unknown";
  const fresh = await env.DB.prepare("INSERT OR IGNORE INTO inbound_messages (org_id, message_id, outcome, created_at) VALUES (?1, ?2, 'queued', ?3)").bind(orgId, `${source}:${parsed.messageId}`, nowIso()).run();
  if ((fresh.meta.changes ?? 0) === 0) return "duplicate";
  await count(env, orgId, "seen");
  const setOutcome = (o: string) => env.DB.prepare("UPDATE inbound_messages SET outcome = ?3 WHERE org_id = ?1 AND message_id = ?2").bind(orgId, `${source}:${parsed.messageId}`, o).run();
  try {
    // Our own mailbox's outgoing copies are not vendor requests.
    if (conn.account && parsed.from.toLowerCase().includes(conn.account.toLowerCase())) { await setOutcome("ignored"); await count(env, orgId, "ignored"); return "ignored"; }
    const verdict = await isBankChangeRequest(env, { from: parsed.from, subject: parsed.subject, text: parsed.text, attachmentNames: parsed.attachments.map((a) => a.filename) });
    if (!verdict.match) { await setOutcome("ignored"); await count(env, orgId, "ignored"); return "ignored"; }
    await count(env, orgId, "matched");
    const fn = intakeFn === undefined ? await loadIntake() : intakeFn;
    if (!fn) { await setOutcome("queued"); return "queued"; }
    const mail = await fetchIncoming(env, { orgId, source, accountId, parsed });
    await fn(env, mail);
    await setOutcome("intake");
    await saveConn(env, orgId, source, { status: "connected", detail: `Watching for new mail · last vendor request ${nowIso().slice(0, 16).replace("T", " ")} UTC` });
    return "intake";
  } catch {
    await setOutcome("failed");
    return "failed";
  }
}

hookRoutes.post("/hooks/composio", async (c) => {
  const env = c.env as IntEnv;
  const raw = await c.req.text();
  const row = await env.DB.prepare("SELECT value FROM settings WHERE key = ?1").bind(SECRET_KEY).first<{ value: string | null }>();
  const secret = row?.value && env.COMPOSIO_API_KEY ? await unseal(env.COMPOSIO_API_KEY, row.value) : null;
  const ok = secret && (await verifyComposioSignature(secret, { id: c.req.header("webhook-id"), timestamp: c.req.header("webhook-timestamp"), signature: c.req.header("webhook-signature") }, raw));
  if (!ok) return c.json({ error: "Signature missing or invalid.", code: "unauthorized" }, 401);
  let json: unknown;
  try { json = JSON.parse(raw); } catch { return c.json({ error: "Body is not JSON.", code: "bad_request" }, 400); }
  const ev = Event.safeParse(json);
  if (!ev.success) return c.json({ error: "Unexpected event.", code: "bad_request" }, 400);
  if (ev.data.type === "composio.connected_account.expired") {
    const org = ev.data.metadata?.user_id;
    if (org) for (const conn of await listConns(env, org)) if (conn.connected_account_id === ev.data.metadata?.connected_account_id) await saveConn(env, org, conn.provider, { status: "error", detail: "Access expired. Reconnect this account." });
    return c.json({ ok: true });
  }
  if (ev.data.type !== "composio.trigger.message") return c.json({ ok: true });
  const work = handleTrigger(env, ev.data);
  try { c.executionCtx.waitUntil(work); } catch { await work; }
  return c.json({ ok: true });
});
