// Dodo Payments over plain fetch. Test mode until DODO_MODE=live and DODO_PAYMENTS_LIVE_API_KEY are set.
import type { CEnv } from "../auth/types";

export const PRODUCT_NAME = "Probity Pro";
export const JUDGE_DISCOUNT_CODE = "NEBIUSJUDGES";
export const PRO_PRICE_CENTS = 4900;

export type DodoMode = "test" | "live";
export const dodoMode = (env: Pick<CEnv, "DODO_MODE">): DodoMode => (env.DODO_MODE === "live" ? "live" : "test");
export const dodoBase = (env: Pick<CEnv, "DODO_MODE">) => (dodoMode(env) === "live" ? "https://live.dodopayments.com" : "https://test.dodopayments.com");
const dodoKey = (env: CEnv) => (dodoMode(env) === "live" ? env.DODO_PAYMENTS_LIVE_API_KEY : env.DODO_PAYMENTS_API_KEY);

export class DodoError extends Error {
  constructor(public status: number, message: string) { super(message); }
}

export async function dodo<T>(env: CEnv, method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
  const key = dodoKey(env);
  if (!key) throw new DodoError(503, "Payments are not configured.");
  const res = await fetch(`${dodoBase(env)}${path}`, {
    method,
    headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch { /* non-JSON error page */ }
  if (!res.ok) throw new DodoError(res.status, (json as { message?: string } | null)?.message ?? `Dodo answered ${res.status}.`);
  return json as T;
}

async function getSetting(env: CEnv, key: string): Promise<string | null> {
  return (await env.DB.prepare("SELECT value FROM settings WHERE key = ?").bind(key).first<{ value: string | null }>())?.value ?? null;
}
const putSetting = (env: CEnv, key: string, value: string) =>
  env.DB.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").bind(key, value).run();

type Page<T> = { items?: T[] };

/** The "Probity Pro" subscription product for the current mode: from D1 settings, else found by name, else created. */
export async function ensureProProduct(env: CEnv): Promise<string> {
  const key = `dodo_${dodoMode(env)}_pro_product_id`;
  const cached = await getSetting(env, key);
  if (cached) return cached;
  for (let page = 0; page < 10; page++) {
    const list = await dodo<Page<{ product_id: string; name: string }>>(env, "GET", `/products?page_size=100&page_number=${page}`);
    const items = list.items ?? [];
    const hit = items.find((p) => p.name === PRODUCT_NAME);
    if (hit) { await putSetting(env, key, hit.product_id); return hit.product_id; }
    if (items.length < 100) break;
  }
  const created = await dodo<{ product_id: string }>(env, "POST", "/products", {
    name: PRODUCT_NAME,
    description: "Gmail, Outlook, Xero and Slack connections, payment-run schedules and 500 checks a month for one company.",
    tax_category: "saas",
    price: {
      type: "recurring_price",
      currency: "USD",
      price: PRO_PRICE_CENTS,
      payment_frequency_count: 1,
      payment_frequency_interval: "Month",
      subscription_period_count: 20,
      subscription_period_interval: "Year",
      trial_period_days: 0,
      zero_amount_payment_method_optional: true,
    },
  });
  await putSetting(env, key, created.product_id);
  return created.product_id;
}

/** The 100%-off judges' code on the Pro product (idempotent by code). */
export async function ensureJudgeDiscount(env: CEnv): Promise<string> {
  try {
    const hit = await dodo<{ discount_id: string }>(env, "GET", `/discounts/code/${JUDGE_DISCOUNT_CODE}`);
    return hit.discount_id;
  } catch (e) {
    if (!(e instanceof DodoError) || e.status !== 404) throw e;
  }
  const productId = await ensureProProduct(env);
  const made = await dodo<{ discount_id: string }>(env, "POST", "/discounts", {
    type: "percentage",
    amount: 10000,
    code: JUDGE_DISCOUNT_CODE,
    name: "Nebius judges",
    restricted_to: [productId],
    preserve_on_plan_change: false,
  });
  return made.discount_id;
}

export type CheckoutInput = { orgId: string; email: string; name: string | null; returnUrl: string; discountCode?: string };

export async function createCheckout(env: CEnv, i: CheckoutInput): Promise<string> {
  const productId = await ensureProProduct(env);
  const res = await dodo<{ checkout_url: string | null }>(env, "POST", "/checkouts", {
    product_cart: [{ product_id: productId, quantity: 1 }],
    customer: { email: i.email, ...(i.name ? { name: i.name } : {}) },
    metadata: { orgId: i.orgId },
    return_url: i.returnUrl,
    ...(i.discountCode ? { discount_codes: [i.discountCode] } : {}),
  });
  if (!res.checkout_url) throw new DodoError(502, "Dodo returned no checkout link.");
  return res.checkout_url;
}

export async function createPortalLink(env: CEnv, customerId: string, returnUrl: string): Promise<string> {
  const res = await dodo<{ link: string }>(env, "POST", `/customers/${encodeURIComponent(customerId)}/customer-portal/session?return_url=${encodeURIComponent(returnUrl)}`);
  return res.link;
}
