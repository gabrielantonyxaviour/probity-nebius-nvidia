// Billing module (Sonnet C): Dodo Payments checkout, portal, webhook and the judge code. Mounted at /api/billing.
import { Hono } from "hono";
import { z } from "zod";
import { deny, getResolved, requireMember } from "../auth/guards";
import type { CEnv } from "../auth/types";
import type { AppEnv, Ctx } from "../routes/util";
import { createCheckout, createPortalLink, DodoError, JUDGE_DISCOUNT_CODE } from "./dodo";
import { getBilling, getProfile } from "./plans";
import { applyEvent, parseEvent, verifyWebhook } from "./webhook";

export { checksLeft, consumeCheck } from "./plans";

const JUDGE_DAYS = 60;
const REDEEM_ATTEMPTS_PER_HOUR = 5;
const cenv = (c: Ctx) => c.env as CEnv;

function payError(c: Ctx, e: unknown) {
  if (e instanceof DodoError && e.status === 503) return c.json({ error: "Payments are not set up yet.", code: "payments_unavailable" }, 503);
  return c.json({ error: "The payment service did not answer. Try again in a moment.", code: "payments_failed" }, 502);
}

function same(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export const billingRoutes = new Hono<AppEnv>();

billingRoutes.get("/", async (c) => c.json(await getBilling(cenv(c), c.get("orgId"))));

const CheckoutBody = z.object({ discountCode: z.literal(JUDGE_DISCOUNT_CODE).optional() }).default({});

billingRoutes.post("/checkout", requireMember("admin"), async (c) => {
  const env = cenv(c);
  const { user, orgId } = getResolved(c);
  const body = CheckoutBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "That discount code is not valid.", code: "bad_request" }, 400);
  try {
    const url = await createCheckout(env, { orgId, email: user!.email, name: user!.name, returnUrl: `${env.APP_URL}/settings?billing=done`, discountCode: body.data.discountCode });
    return c.json({ url });
  } catch (e) {
    return payError(c, e);
  }
});

billingRoutes.post("/portal", requireMember("admin"), async (c) => {
  const env = cenv(c);
  const profile = await getProfile(env, c.get("orgId"));
  if (!profile?.dodo_customer_id) return c.json({ error: "There is no subscription to manage yet.", code: "no_subscription" }, 409);
  try {
    return c.json({ url: await createPortalLink(env, profile.dodo_customer_id, `${env.APP_URL}/settings`) });
  } catch (e) {
    return payError(c, e);
  }
});

// Dodo calls this with a signed body; there is no user session. Nothing is trusted before the signature checks out.
billingRoutes.post("/webhook", async (c) => {
  const env = cenv(c);
  const raw = await c.req.text();
  const check = await verifyWebhook(env.DODO_WEBHOOK_SECRET, c.req.raw.headers, raw);
  if (!check.ok) return c.json({ error: "Invalid signature.", code: check.reason }, check.reason === "no_secret" ? 503 : 401);
  const event = parseEvent(raw);
  if (!event) return c.json({ error: "Unreadable event.", code: "bad_request" }, 400);
  const res = await applyEvent(env, c.req.header("webhook-id")!, event);
  return c.json({ received: true, applied: res.applied });
});

const RedeemBody = z.object({ code: z.string().trim().min(1).max(100) });

billingRoutes.post("/redeem", requireMember("admin"), async (c) => {
  const env = cenv(c);
  const { orgId, user } = getResolved(c);
  const body = RedeemBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Enter the code you were given.", code: "bad_request" }, 400);
  // Either the private judge code or the public Dodo discount code unlocks the grant, so judges never need a card.
  const codes = [env.JUDGE_CODE, JUDGE_DISCOUNT_CODE].filter((x): x is string => !!x).map((x) => x.trim().toLowerCase());
  const bucket = `redeem:${user!.id}:${new Date().toISOString().slice(0, 13)}`;
  const tries = Number((await env.CACHE.get(bucket)) ?? 0);
  if (tries >= REDEEM_ATTEMPTS_PER_HOUR) return c.json({ error: "Too many attempts. Try again in an hour.", code: "rate_limited" }, 429);
  if (!codes.some((k) => same(body.data.code.toLowerCase(), k))) {
    await env.CACHE.put(bucket, String(tries + 1), { expirationTtl: 3600 });
    return c.json({ error: "That code is not valid.", code: "invalid_code" }, 422);
  }
  const now = new Date();
  const until = new Date(now.getTime() + JUDGE_DAYS * 24 * 3600 * 1000).toISOString();
  // A paying customer keeps their own renewal date; the grant never shortens it.
  await env.DB.prepare(
    `UPDATE org_profile SET plan = 'pro', plan_status = 'active',
       plan_renews_at = CASE WHEN plan_renews_at IS NOT NULL AND plan_renews_at > ? THEN plan_renews_at ELSE ? END, plan_updated_at = ? WHERE org_id = ?`,
  ).bind(until, until, now.toISOString(), orgId).run();
  return c.json(await getBilling(env, orgId));
});
