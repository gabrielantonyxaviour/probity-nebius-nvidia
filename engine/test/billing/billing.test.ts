import { afterEach, describe, expect, it, vi } from "vitest";
import { Me } from "@probity/shared";
import { ensureProProduct } from "../../src/billing/dodo";
import { signWebhook } from "../../src/billing/webhook";
import { checksLeft, consumeCheck, getPlan } from "../../src/billing/plans";
import { Client, makeApp, makeTestEnv } from "../auth/helpers";

afterEach(() => vi.unstubAllGlobals());

async function owner(env = makeTestEnv()) {
  const c = new Client(makeApp(), env);
  await c.signIn("controller@acmefreight.example");
  const me = Me.parse((await c.json("/api/workspaces", { body: { name: "Acme Freight Ltd" } })).body);
  return { c, env, orgId: me.org.id };
}

// Raw-body variant: the signed bytes must be exactly what is sent.
async function post(c: Client, body: unknown, over: { id?: string; ts?: number; secret?: string; sig?: string } = {}) {
  const raw = JSON.stringify(body);
  const id = over.id ?? `msg_${crypto.randomUUID()}`;
  const ts = String(over.ts ?? Math.floor(Date.now() / 1000));
  const sig = over.sig ?? `v1,${await signWebhook(over.secret ?? c.env.DODO_WEBHOOK_SECRET!, id, ts, raw)}`;
  const res = await c.app.request("http://localhost:3200/api/billing/webhook", { method: "POST", headers: { "content-type": "application/json", "webhook-id": id, "webhook-timestamp": ts, "webhook-signature": sig }, body: raw }, c.env);
  return { status: res.status, body: (await res.json()) as { applied?: boolean; code?: string } };
}

const evt = (type: string, orgId: string | null, extra: Record<string, unknown> = {}, timestamp = "2026-10-30T02:00:00Z") => ({
  business_id: "bus_test", type, timestamp,
  data: { payload_type: "Subscription", subscription_id: "sub_123", customer: { customer_id: "cus_456", email: "controller@acmefreight.example" }, metadata: orgId ? { orgId } : {}, next_billing_date: "2026-11-30T02:00:00Z", ...extra },
});

describe("webhook signature", () => {
  it("accepts a good signature and upgrades the company", async () => {
    const { c, orgId } = await owner();
    const r = await post(c, evt("subscription.active", orgId));
    expect(r).toMatchObject({ status: 200, body: { applied: true } });
    const b = (await c.json("/api/billing")).body as any;
    expect(b).toMatchObject({ plan: "pro", status: "active", renewsAt: "2026-11-30T02:00:00Z", limits: { checksPerMonth: 500 } });
    expect(Me.parse((await c.json("/api/me")).body).org.plan).toBe("pro");
  });
  it("rejects a bad signature, a wrong secret, missing headers and an old timestamp", async () => {
    const { c, orgId } = await owner();
    expect((await post(c, evt("subscription.active", orgId), { sig: "v1,AAAA" })).status).toBe(401);
    expect((await post(c, evt("subscription.active", orgId), { secret: "whsec_" + btoa("someone-elses-secret-0123456789ab") })).status).toBe(401);
    expect((await post(c, evt("subscription.active", orgId), { ts: Math.floor(Date.now() / 1000) - 600 })).status).toBe(401);
    const bare = await c.app.request("http://localhost:3200/api/billing/webhook", { method: "POST", body: "{}" }, c.env);
    expect(bare.status).toBe(401);
    expect((await c.json("/api/billing")).body).toMatchObject({ plan: "free", status: "none" });
  });
  it("refuses everything when no secret is configured", async () => {
    const { c, orgId } = await owner(makeTestEnv({ DODO_WEBHOOK_SECRET: undefined }));
    expect((await post(c, evt("subscription.active", orgId), { secret: "whsec_" + btoa("x") })).status).toBe(503);
  });
});

describe("subscription lifecycle", () => {
  it("handles duplicates, hold, renewal, failure and cancellation; maps by subscription id when metadata is missing", async () => {
    const { c, orgId } = await owner();
    const first = await post(c, evt("subscription.active", orgId), { id: "msg_1" });
    expect(first.body.applied).toBe(true);
    expect((await post(c, evt("subscription.active", orgId), { id: "msg_1" })).body.applied).toBe(false); // redelivery

    expect((await post(c, evt("subscription.on_hold", null, {}, "2026-11-30T03:00:00Z"))).body.applied).toBe(true); // found by subscription id
    expect((await c.json("/api/billing")).body).toMatchObject({ plan: "free", status: "on_hold" });
    expect((await post(c, evt("subscription.renewed", null, { next_billing_date: "2026-12-30T02:00:00Z" }, "2026-11-30T04:00:00Z"))).body.applied).toBe(true);
    expect((await c.json("/api/billing")).body).toMatchObject({ plan: "pro", status: "active", renewsAt: "2026-12-30T02:00:00Z" });
    // A late, older event does not roll the state back.
    expect((await post(c, evt("subscription.on_hold", null, {}, "2026-11-30T03:30:00Z"))).body.applied).toBe(false);
    expect((await c.json("/api/billing")).body).toMatchObject({ status: "active" });

    expect((await post(c, evt("subscription.failed", null, {}, "2026-12-01T00:00:00Z"))).body.applied).toBe(true);
    expect((await c.json("/api/billing")).body).toMatchObject({ plan: "free", status: "failed" });
    expect((await post(c, evt("payment.succeeded", orgId))).body.applied).toBe(false); // not a plan event
  });
  it("a cancelled subscription stays pro until the paid period ends", async () => {
    const { c, env, orgId } = await owner();
    const future = new Date(Date.now() + 10 * 864e5).toISOString();
    await post(c, evt("subscription.cancelled", orgId, { next_billing_date: future }));
    expect(await getPlan(env, orgId)).toBe("pro");
    await env.DB.prepare("UPDATE org_profile SET plan_renews_at = ? WHERE org_id = ?").bind(new Date(Date.now() - 864e5).toISOString(), orgId).run();
    expect(await getPlan(env, orgId)).toBe("free");
  });
  it("ignores an event for an unknown company", async () => {
    const { c } = await owner();
    const r = await post(c, { ...evt("subscription.active", "org_nope"), data: { subscription_id: "sub_other", metadata: { orgId: "org_nope" } } });
    expect(r).toMatchObject({ status: 200, body: { applied: false } });
  });
});

describe("redeem code", () => {
  it("grants pro for 60 days with the right code, case-insensitively", async () => {
    const { c, orgId, env } = await owner();
    const r = await c.json("/api/billing/redeem", { body: { code: " JUDGE-open-sesame " } });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ plan: "pro", status: "active" });
    const days = (Date.parse(r.body.renewsAt) - Date.now()) / 864e5;
    expect(days).toBeGreaterThan(59.9);
    expect(days).toBeLessThanOrEqual(60);
    expect(await getPlan(env, orgId)).toBe("pro");
  });
  it("rejects a wrong code, throttles guesses, and needs a signed-in admin", async () => {
    const { c } = await owner();
    for (let i = 0; i < 5; i++) expect((await c.json("/api/billing/redeem", { body: { code: `guess-${i}` } })).status).toBe(422);
    expect((await c.json("/api/billing/redeem", { body: { code: "judge-open-sesame" } })).status).toBe(429);
    const anon = new Client(makeApp(), makeTestEnv());
    expect((await anon.json("/api/billing/redeem", { body: { code: "judge-open-sesame" } })).status).toBe(401);
  });
  it("a lapsed grant stops counting as pro", async () => {
    const { c, env, orgId } = await owner();
    await c.json("/api/billing/redeem", { body: { code: "judge-open-sesame" } });
    await env.DB.prepare("UPDATE org_profile SET plan_renews_at = ? WHERE org_id = ?").bind(new Date(Date.now() - 5 * 864e5).toISOString(), orgId).run();
    expect(await getPlan(env, orgId)).toBe("free");
  });
});

describe("checkout and portal", () => {
  function stubDodo(calls: { url: string; method: string; body: any }[]) {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init.method ?? "GET", body });
      const u = new URL(url);
      if (u.pathname === "/products" && init.method === "GET") return Response.json({ items: [{ product_id: "pdt_pro", name: "Probity Pro" }] });
      if (u.pathname === "/checkouts") return Response.json({ session_id: "cks_1", checkout_url: "https://test.checkout.dodopayments.com/session/cks_1" });
      if (u.pathname.endsWith("/customer-portal/session")) return Response.json({ link: "https://test.customer.dodopayments.com/p/abc" });
      return new Response("{}", { status: 404 });
    });
  }
  it("creates a checkout with the org id in metadata and the return url", async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    stubDodo(calls);
    const { c, orgId } = await owner(makeTestEnv({ DODO_PAYMENTS_API_KEY: "test-key" }));
    const r = await c.json("/api/billing/checkout", { body: {} });
    expect(r).toMatchObject({ status: 200, body: { url: "https://test.checkout.dodopayments.com/session/cks_1" } });
    const sent = calls.find((x) => x.url.endsWith("/checkouts"))!;
    expect(sent.url.startsWith("https://test.dodopayments.com")).toBe(true);
    expect(sent.body).toMatchObject({
      product_cart: [{ product_id: "pdt_pro", quantity: 1 }],
      customer: { email: "controller@acmefreight.example" },
      metadata: { orgId },
      return_url: "http://localhost:3200/settings?billing=done",
    });
    expect(sent.body.discount_codes).toBeUndefined();
    // The product id is remembered so the next checkout skips the lookup.
    const before = calls.filter((x) => x.url.includes("/products")).length;
    await c.json("/api/billing/checkout", { body: { discountCode: "NEBIUSJUDGES" } });
    expect(calls.filter((x) => x.url.includes("/products")).length).toBe(before);
    expect(calls.filter((x) => x.url.endsWith("/checkouts")).at(-1)!.body.discount_codes).toEqual(["NEBIUSJUDGES"]);
  });
  it("uses the live host and key in live mode", async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    stubDodo(calls);
    const { c } = await owner(makeTestEnv({ DODO_MODE: "live", DODO_PAYMENTS_LIVE_API_KEY: "live-key", DODO_PAYMENTS_API_KEY: "test-key" }));
    await c.json("/api/billing/checkout", { body: {} });
    expect(calls.every((x) => x.url.startsWith("https://live.dodopayments.com"))).toBe(true);
  });
  it("is guarded: signed-out 401, demo and non-admin 403, bad discount 400, unconfigured 503, Dodo down 502", async () => {
    stubDodo([]);
    const anon = new Client(makeApp(), makeTestEnv({ DODO_PAYMENTS_API_KEY: "k" }));
    expect((await anon.json("/api/billing/checkout", { body: {} })).status).toBe(401);
    const { c, env, orgId } = await owner(makeTestEnv({ DODO_PAYMENTS_API_KEY: "k" }));
    expect((await c.json("/api/billing/checkout", { body: { discountCode: "FREEFOREVER" } })).status).toBe(400);
    await env.DB.prepare("UPDATE member SET role = 'member' WHERE organizationId = ?").bind(orgId).run();
    expect((await c.json("/api/billing/checkout", { body: {} })).status).toBe(403);
    expect((await c.json("/api/billing/portal", { body: {} })).status).toBe(403);
    await env.DB.prepare("UPDATE member SET role = 'owner' WHERE organizationId = ?").bind(orgId).run();
    vi.stubGlobal("fetch", async () => new Response("boom", { status: 500 }));
    expect((await c.json("/api/billing/checkout", { body: {} })).status).toBe(502);
    const none = await owner(makeTestEnv());
    expect((await none.c.json("/api/billing/checkout", { body: {} })).status).toBe(503);
  });
  it("portal needs a subscription, then returns the customer portal link", async () => {
    const calls: { url: string; method: string; body: any }[] = [];
    stubDodo(calls);
    const { c, env, orgId } = await owner(makeTestEnv({ DODO_PAYMENTS_API_KEY: "k" }));
    expect((await c.json("/api/billing/portal", { body: {} })).status).toBe(409);
    await post(c, evt("subscription.active", orgId));
    const r = await c.json("/api/billing/portal", { body: {} });
    expect(r.body).toEqual({ url: "https://test.customer.dodopayments.com/p/abc" });
    expect(calls.at(-1)!.url).toContain("/customers/cus_456/customer-portal/session?return_url=");
    void env;
  });
});

describe("check meter", () => {
  it("free allows 25 a month, pro 500, atomically; the demo follows the pro limit", async () => {
    const { env, orgId } = await owner();
    expect(await checksLeft(env, orgId)).toBe(25);
    for (let i = 0; i < 25; i++) expect(await consumeCheck(env, orgId)).toBe(true);
    expect(await consumeCheck(env, orgId)).toBe(false);
    expect(await checksLeft(env, orgId)).toBe(0);
    await env.DB.prepare("UPDATE org_profile SET plan = 'pro', plan_status = 'active', plan_renews_at = NULL WHERE org_id = ?").bind(orgId).run();
    expect(await checksLeft(env, orgId)).toBe(475);
    expect(await consumeCheck(env, orgId)).toBe(true);
    expect(await checksLeft(env, "org_demo")).toBe(500);
  });
});

describe("brand and live mode", () => {
  type Call = { url: string; method: string; body: any };
  function stub(calls: Call[], products: { product_id: string; name: string; brand_id?: string | null }[]) {
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      calls.push({ url, method: init.method ?? "GET", body });
      const u = new URL(url);
      if (u.pathname === "/products" && init.method === "GET") return Response.json({ items: products });
      if (u.pathname === "/products" && init.method === "POST") return Response.json({ product_id: "pdt_new" });
      if (u.pathname.startsWith("/products/") && init.method === "PATCH") return Response.json({});
      return new Response("{}", { status: 404 });
    });
  }
  it("creates the product on the Probity brand, in either mode", async () => {
    for (const mode of ["test", "live"] as const) {
      const calls: Call[] = [];
      stub(calls, []);
      const env = makeTestEnv({ DODO_MODE: mode, DODO_BRAND_ID: "brnd_0Nqnyy64ALmi3fK2GK7ks", DODO_PAYMENTS_API_KEY: "t", DODO_PAYMENTS_LIVE_API_KEY: "l" });
      expect(await ensureProProduct(env)).toBe("pdt_new");
      const create = calls.find((c) => c.method === "POST")!;
      expect(create.url).toBe(`https://${mode}.dodopayments.com/products`);
      expect(create.body).toMatchObject({ name: "Probity Pro", brand_id: "brnd_0Nqnyy64ALmi3fK2GK7ks", tax_category: "saas" });
      expect(create.body.price).toMatchObject({ price: 4900, currency: "USD", zero_amount_payment_method_optional: true, subscription_period_count: 20 });
      vi.unstubAllGlobals();
    }
  });
  it("without DODO_BRAND_ID no brand is sent; an existing product on another brand is moved onto it", async () => {
    const calls: Call[] = [];
    stub(calls, []);
    await ensureProProduct(makeTestEnv({ DODO_PAYMENTS_API_KEY: "t" }));
    expect(calls.find((c) => c.method === "POST")!.body.brand_id).toBeUndefined();
    vi.unstubAllGlobals();

    const moved: Call[] = [];
    stub(moved, [{ product_id: "pdt_old", name: "Probity Pro", brand_id: "brnd_larinova" }]);
    const env = makeTestEnv({ DODO_BRAND_ID: "brnd_probity", DODO_PAYMENTS_API_KEY: "t" });
    expect(await ensureProProduct(env)).toBe("pdt_old");
    expect(moved.find((c) => c.method === "PATCH")).toMatchObject({ url: "https://test.dodopayments.com/products/pdt_old", body: { brand_id: "brnd_probity" } });
    vi.unstubAllGlobals();

    const same: Call[] = [];
    stub(same, [{ product_id: "pdt_old", name: "Probity Pro", brand_id: "brnd_probity" }]);
    await ensureProProduct(makeTestEnv({ DODO_BRAND_ID: "brnd_probity", DODO_PAYMENTS_API_KEY: "t" }));
    expect(same.some((c) => c.method === "PATCH")).toBe(false);
  });
  it("an unknown brand (the Probity brand exists in live only) does not block the product", async () => {
    const calls: Call[] = [];
    let n = 0;
    vi.stubGlobal("fetch", async (url: string, init: RequestInit) => {
      calls.push({ url, method: init.method ?? "GET", body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (init.method === "GET") return Response.json({ items: [] });
      return n++ === 0 ? Response.json({ message: "Brand ID could not be found" }, { status: 422 }) : Response.json({ product_id: "pdt_nobrand" });
    });
    expect(await ensureProProduct(makeTestEnv({ DODO_BRAND_ID: "brnd_live_only", DODO_PAYMENTS_API_KEY: "t" }))).toBe("pdt_nobrand");
    const posts = calls.filter((c) => c.method === "POST");
    expect(posts[0]!.body.brand_id).toBe("brnd_live_only");
    expect(posts[1]!.body.brand_id).toBeUndefined();
  });
  it("the webhook handler works in live mode with whatever DODO_WEBHOOK_SECRET is set, and rejects the other mode's secret", async () => {
    const liveSecret = "whsec_" + btoa("live-endpoint-secret-bytes-0123456789");
    const env = makeTestEnv({ DODO_MODE: "live", DODO_WEBHOOK_SECRET: liveSecret });
    const c = new Client(makeApp(), env);
    await c.signIn("controller@acmefreight.example");
    const orgId = Me.parse((await c.json("/api/workspaces", { body: { name: "Acme Freight Ltd" } })).body).org.id;
    expect((await post(c, evt("subscription.active", orgId), { secret: "whsec_" + btoa("webhook-test-secret-bytes-0123456789") })).status).toBe(401);
    expect((await post(c, evt("subscription.active", orgId))).body.applied).toBe(true);
    expect((await c.json("/api/billing")).body).toMatchObject({ plan: "pro", status: "active" });
  });
});
