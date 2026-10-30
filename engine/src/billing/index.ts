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

/** A Dodo checkout for this company, refused while a live subscription already exists (a second one would bill twice). */
async function startCheckout(c: Ctx, discountCode?: string) {
  const env = cenv(c);
  const { user, orgId } = getResolved(c);
  const profile = await getProfile(env, orgId);
  if (profile?.dodo_subscription_id && (profile.plan_status === "active" || profile.plan_status === "on_hold")) {
    return c.json({ error: "This workspace already has a subscription. Use Manage billing.", code: "already_subscribed" }, 409);
  }
  try {
    const url = await createCheckout(env, { orgId, email: user!.email, name: user!.name, returnUrl: `${env.APP_URL}/settings?billing=done`, discountCode });
    return c.json({ url });
  } catch (e) {
    return payError(c, e);
  }
}

export const billingRoutes = new Hono<AppEnv>();

billingRoutes.get("/", async (c) => c.json(await getBilling(cenv(c), c.get("orgId"))));

const CheckoutBody = z.object({ discountCode: z.literal(JUDGE_DISCOUNT_CODE).optional() }).default({});

billingRoutes.post("/checkout", requireMember("admin"), async (c) => {
  const body = CheckoutBody.safeParse(await c.req.json().catch(() => ({})));
  if (!body.success) return c.json({ error: "That discount code is not valid.", code: "bad_request" }, 400);
  return startCheckout(c, body.data.discountCode);
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

// A judge's code never grants a plan locally. It checks the code (rate limited), then returns the Dodo checkout for the
// 100%-off discount: completing it creates a real $0 subscription, and the signed webhook is what turns the plan on.
billingRoutes.post("/redeem", requireMember("admin"), async (c) => {
  const env = cenv(c);
  const { user } = getResolved(c);
  const body = RedeemBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Enter the code you were given.", code: "bad_request" }, 400);
  const codes = [env.JUDGE_CODE, JUDGE_DISCOUNT_CODE].filter((x): x is string => !!x).map((x) => x.trim().toLowerCase());
  const bucket = `redeem:${user!.id}:${new Date().toISOString().slice(0, 13)}`;
  const tries = Number((await env.CACHE.get(bucket)) ?? 0);
  if (tries >= REDEEM_ATTEMPTS_PER_HOUR) return c.json({ error: "Too many attempts. Try again in an hour.", code: "rate_limited" }, 429);
  if (!codes.some((k) => same(body.data.code.toLowerCase(), k))) {
    await env.CACHE.put(bucket, String(tries + 1), { expirationTtl: 3600 });
    return c.json({ error: "That code is not valid.", code: "invalid_code" }, 422);
  }
  return startCheckout(c, JUDGE_DISCOUNT_CODE);
});
