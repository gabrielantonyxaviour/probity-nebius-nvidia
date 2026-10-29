// Plans, effective plan per company, and the monthly check meter.
import { DEMO_ORG_ID, type Billing, type Plan } from "@probity/shared";
import type { Env } from "../env";

export const PLAN_LIMITS: Record<Plan, { checksPerMonth: number }> = { free: { checksPerMonth: 25 }, pro: { checksPerMonth: 500 } };
export const PRICE_LABEL = "$49 / month per company";
const GRACE_MS = 3 * 24 * 3600 * 1000; // a late renewal webhook must not lock a paying customer out

export type ProfileRow = {
  org_id: string;
  plan: string;
  plan_status: string;
  plan_renews_at: string | null;
  dodo_customer_id: string | null;
  dodo_subscription_id: string | null;
  plan_updated_at: string | null;
};
type Db = Pick<Env, "DB">;

export async function getProfile(env: Db, orgId: string): Promise<ProfileRow | null> {
  return env.DB.prepare("SELECT org_id, plan, plan_status, plan_renews_at, dodo_customer_id, dodo_subscription_id, plan_updated_at FROM org_profile WHERE org_id = ?").bind(orgId).first<ProfileRow>();
}

/** Pro while the subscription is active (or cancelled but paid through the period) and the paid-through date has not lapsed. */
export function effectivePlan(p: ProfileRow | null, now = Date.now()): Plan {
  if (!p || p.plan !== "pro") return "free";
  if (p.plan_status !== "active" && p.plan_status !== "cancelled") return "free";
  const t = p.plan_renews_at ? Date.parse(p.plan_renews_at) : NaN;
  if (p.plan_status === "cancelled") return t > now ? "pro" : "free"; // paid through the period, no grace
  if (Number.isFinite(t) && t + GRACE_MS < now) return "free";
  return "pro";
}

export async function getPlan(env: Db, orgId: string): Promise<Plan> {
  if (orgId === DEMO_ORG_ID) return "pro";
  return effectivePlan(await getProfile(env, orgId));
}

const monthKey = (d = new Date()) => d.toISOString().slice(0, 7);

export async function checksUsed(env: Db, orgId: string, month = monthKey()): Promise<number> {
  const row = await env.DB.prepare("SELECT n FROM check_usage WHERE org_id = ? AND month = ?").bind(orgId, month).first<{ n: number }>();
  return row?.n ?? 0;
}

export async function checksLeft(env: Db, orgId: string): Promise<number> {
  const limit = PLAN_LIMITS[await getPlan(env, orgId)].checksPerMonth;
  return Math.max(0, limit - (await checksUsed(env, orgId)));
}

/** Counts one check against this month's allowance. Atomic: false (and nothing counted) when the allowance is used up. */
export async function consumeCheck(env: Db, orgId: string): Promise<boolean> {
  const limit = PLAN_LIMITS[await getPlan(env, orgId)].checksPerMonth;
  const row = await env.DB.prepare(
    "INSERT INTO check_usage (org_id, month, n) VALUES (?, ?, 1) ON CONFLICT(org_id, month) DO UPDATE SET n = n + 1 WHERE n < ? RETURNING n",
  ).bind(orgId, monthKey(), limit).first<{ n: number }>();
  return row !== null;
}

export async function getBilling(env: Db, orgId: string): Promise<Billing> {
  const p = await getProfile(env, orgId);
  const plan = orgId === DEMO_ORG_ID ? "pro" : effectivePlan(p);
  const status = (p?.plan_status ?? "none") as Billing["status"];
  return {
    plan,
    status,
    renewsAt: p?.plan_renews_at ?? null,
    priceLabel: PRICE_LABEL,
    limits: { checksPerMonth: PLAN_LIMITS[plan].checksPerMonth, checksUsed: await checksUsed(env, orgId) },
  };
}
