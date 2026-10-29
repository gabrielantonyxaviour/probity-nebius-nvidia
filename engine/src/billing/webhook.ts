// Dodo webhooks: Standard Webhooks signature check (HMAC-SHA256 over "id.timestamp.body", 5 minute tolerance) and the plan updates.
import { z } from "zod";
import type { Env } from "../env";

const TOLERANCE_S = 5 * 60;

const b64decode = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const b64encode = (buf: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(buf)));

export async function signWebhook(secret: string, id: string, timestamp: string, body: string): Promise<string> {
  const raw = secret.startsWith("whsec_") ? secret.slice(6) : secret;
  let keyBytes: Uint8Array;
  try { keyBytes = b64decode(raw); } catch { keyBytes = new TextEncoder().encode(raw); }
  const key = await crypto.subtle.importKey("raw", keyBytes as BufferSource, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64encode(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${id}.${timestamp}.${body}`)));
}

function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export type Verified = { ok: true } | { ok: false; reason: "missing_headers" | "stale" | "bad_signature" | "no_secret" };

export async function verifyWebhook(secret: string | undefined, headers: Headers, body: string, nowMs = Date.now()): Promise<Verified> {
  if (!secret) return { ok: false, reason: "no_secret" };
  const id = headers.get("webhook-id");
  const ts = headers.get("webhook-timestamp");
  const sig = headers.get("webhook-signature");
  if (!id || !ts || !sig) return { ok: false, reason: "missing_headers" };
  const t = Number(ts);
  if (!Number.isFinite(t) || Math.abs(nowMs / 1000 - t) > TOLERANCE_S) return { ok: false, reason: "stale" };
  const expected = await signWebhook(secret, id, ts, body);
  const ok = sig.split(" ").some((part) => {
    const [version, value] = part.split(",");
    return version === "v1" && !!value && safeEqual(value, expected);
  });
  return ok ? { ok: true } : { ok: false, reason: "bad_signature" };
}

const Event = z.object({
  type: z.string(),
  timestamp: z.string().optional(),
  data: z.object({
    subscription_id: z.string().optional(),
    next_billing_date: z.string().nullish(),
    metadata: z.record(z.unknown()).nullish(),
    customer: z.object({ customer_id: z.string().optional() }).passthrough().nullish(),
  }).passthrough(),
});
export type DodoEvent = z.infer<typeof Event>;
export const parseEvent = (raw: string): DodoEvent | null => {
  try { const r = Event.safeParse(JSON.parse(raw)); return r.success ? r.data : null; } catch { return null; }
};

const EFFECT: Record<string, { plan: "pro" | "free"; status: string }> = {
  "subscription.active": { plan: "pro", status: "active" },
  "subscription.renewed": { plan: "pro", status: "active" },
  "subscription.on_hold": { plan: "pro", status: "on_hold" },
  "subscription.cancelled": { plan: "pro", status: "cancelled" },
  "subscription.failed": { plan: "free", status: "failed" },
  "subscription.expired": { plan: "free", status: "cancelled" },
};

async function findOrg(env: Pick<Env, "DB">, e: DodoEvent): Promise<string | null> {
  const meta = e.data.metadata?.["orgId"];
  if (typeof meta === "string") {
    const r = await env.DB.prepare("SELECT org_id FROM org_profile WHERE org_id = ?").bind(meta).first<{ org_id: string }>();
    if (r) return r.org_id;
  }
  const sub = e.data.subscription_id;
  if (sub) {
    const r = await env.DB.prepare("SELECT org_id FROM org_profile WHERE dodo_subscription_id = ?").bind(sub).first<{ org_id: string }>();
    if (r) return r.org_id;
  }
  const cus = e.data.customer?.customer_id;
  if (cus) {
    const r = await env.DB.prepare("SELECT org_id FROM org_profile WHERE dodo_customer_id = ?").bind(cus).first<{ org_id: string }>();
    if (r) return r.org_id;
  }
  return null;
}

/** Applies one verified delivery. Duplicates (same webhook-id) and events older than the last applied one change nothing. */
export async function applyEvent(env: Pick<Env, "DB">, webhookId: string, e: DodoEvent): Promise<{ applied: boolean; orgId: string | null }> {
  const now = new Date().toISOString();
  const seen = await env.DB.prepare("INSERT INTO billing_events (webhook_id, type, received_at) VALUES (?, ?, ?) ON CONFLICT(webhook_id) DO NOTHING RETURNING webhook_id").bind(webhookId, e.type, now).first();
  if (!seen) return { applied: false, orgId: null };
  const effect = EFFECT[e.type];
  if (!effect) return { applied: false, orgId: null };
  const orgId = await findOrg(env, e);
  if (!orgId) return { applied: false, orgId: null };
  const at = e.timestamp ?? now;
  const row = await env.DB.prepare(
    `UPDATE org_profile SET plan = ?, plan_status = ?, plan_renews_at = COALESCE(?, plan_renews_at), dodo_subscription_id = COALESCE(?, dodo_subscription_id),
       dodo_customer_id = COALESCE(?, dodo_customer_id), plan_updated_at = ?
     WHERE org_id = ? AND (plan_updated_at IS NULL OR plan_updated_at <= ?) RETURNING org_id`,
  ).bind(effect.plan, effect.status, e.data.next_billing_date ?? null, e.data.subscription_id ?? null, e.data.customer?.customer_id ?? null, at, orgId, at).first();
  await env.DB.prepare("UPDATE billing_events SET org_id = ?, applied = ? WHERE webhook_id = ?").bind(orgId, row ? 1 : 0, webhookId).run();
  return { applied: row !== null, orgId };
}
