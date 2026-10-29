import { describe, expect, it } from "vitest";
import { Me } from "@probity/shared";
import { Client, lastCode, makeApp, makeTestEnv } from "./helpers";

const fresh = () => { const env = makeTestEnv(); return new Client(makeApp(), env); };

describe("sign-in by e-mail code", () => {
  it("signed out: the demo company, role viewer, userId null", async () => {
    const c = fresh();
    const me = await c.json("/api/me");
    expect(me.status).toBe(200);
    const parsed = Me.parse(me.body);
    expect(parsed.user).toBeNull();
    expect(parsed.org).toMatchObject({ id: "org_demo", isDemo: true, role: "viewer", name: "Halvorsen Mission Systems (demo)" });
    expect((await c.json("/api/probe")).body).toEqual({ orgId: "org_demo", userId: null });
  });

  it("sends a 6-digit code (outbox in local mode), signs in, and creates a workspace", async () => {
    const c = fresh();
    const send = await c.json("/api/auth/email-otp/send-verification-otp", { body: { email: "priya.nair@acmefreight.example", type: "sign-in" } });
    expect(send.status).toBe(200);
    const code = await lastCode(c.env, "priya.nair@acmefreight.example");
    expect(code).toMatch(/^\d{6}$/);
    const si = await c.req("/api/auth/sign-in/email-otp", { body: { email: "priya.nair@acmefreight.example", otp: code } });
    expect(si.status).toBe(200);
    expect(si.headers.getSetCookie().join(";")).toMatch(/probity\.session_token=.*SameSite=Lax/i);

    // Signed in but without a company yet: still the demo company, userId null, orgs empty.
    const before = Me.parse((await c.json("/api/me")).body);
    expect(before.user?.email).toBe("priya.nair@acmefreight.example");
    expect(before.org.isDemo).toBe(true);
    expect(before.orgs).toEqual([]);
    expect((await c.json("/api/probe")).body).toEqual({ orgId: "org_demo", userId: null });

    const made = await c.json("/api/workspaces", { body: { name: "Acme Freight Ltd" } });
    expect(made.status).toBe(201);
    const me = Me.parse(made.body);
    expect(me.org).toMatchObject({ name: "Acme Freight Ltd", isDemo: false, plan: "free", role: "owner" });
    expect(me.orgs).toEqual([{ id: me.org.id, name: "Acme Freight Ltd" }]);

    const probe = (await c.json("/api/probe")).body;
    expect(probe).toEqual({ orgId: me.org.id, userId: me.user!.id });
    const profile = await c.env.DB.prepare("SELECT plan, plan_status FROM org_profile WHERE org_id = ?").bind(me.org.id).first();
    expect(profile).toEqual({ plan: "free", plan_status: "none" });
  });

  it("rejects a wrong code and stops after three attempts", async () => {
    const c = fresh();
    await c.req("/api/auth/email-otp/send-verification-otp", { body: { email: "x@acmefreight.example", type: "sign-in" } });
    const real = await lastCode(c.env, "x@acmefreight.example");
    const wrong = real === "000000" ? "111111" : "000000";
    for (let i = 0; i < 3; i++) expect((await c.req("/api/auth/sign-in/email-otp", { body: { email: "x@acmefreight.example", otp: wrong } })).status).toBeGreaterThanOrEqual(400);
    expect((await c.req("/api/auth/sign-in/email-otp", { body: { email: "x@acmefreight.example", otp: real } })).status).toBeGreaterThanOrEqual(400);
    expect(Me.parse((await c.json("/api/me")).body).user).toBeNull();
  });

  it("a returning user lands in their workspace; switching checks membership", async () => {
    const env = makeTestEnv();
    const a = new Client(makeApp(), env);
    await a.signIn("owner@acmefreight.example");
    const me = Me.parse((await a.json("/api/workspaces", { body: { name: "Acme Freight Ltd" } })).body);
    const second = Me.parse((await a.json("/api/workspaces", { body: { name: "Acme Logistics GmbH" } })).body);
    expect(second.orgs).toHaveLength(2);
    expect(Me.parse((await a.json("/api/workspaces/switch", { body: { orgId: me.org.id } })).body).org.name).toBe("Acme Freight Ltd");
    expect((await a.json("/api/probe")).body).toMatchObject({ orgId: me.org.id });
    expect((await a.json("/api/workspaces/switch", { body: { orgId: "org_demo" } })).status).toBe(403);

    // Another user cannot switch into it, and sign-out returns to the demo company.
    const b = new Client(makeApp(), env);
    await b.signIn("outsider@elsewhere.example");
    expect((await b.json("/api/workspaces/switch", { body: { orgId: me.org.id } })).status).toBe(403);
    await a.req("/api/auth/sign-out", { body: {} });
    expect(Me.parse((await a.json("/api/me")).body).user).toBeNull();
  });

  it("requires a session to create a workspace and a real name", async () => {
    const c = fresh();
    expect((await c.json("/api/workspaces", { body: { name: "Acme" } })).status).toBe(401);
    await c.signIn("someone@acmefreight.example");
    expect((await c.json("/api/workspaces", { body: { name: " " } })).status).toBe(400);
  });

  it("a removed member falls back to the demo company even with a stale active organisation", async () => {
    const env = makeTestEnv();
    const c = new Client(makeApp(), env);
    await c.signIn("former@acmefreight.example");
    const me = Me.parse((await c.json("/api/workspaces", { body: { name: "Acme Freight Ltd" } })).body);
    await env.DB.prepare("DELETE FROM member WHERE organizationId = ?").bind(me.org.id).run();
    expect((await c.json("/api/probe")).body).toEqual({ orgId: "org_demo", userId: null });
  });

  it("limits code requests to three a minute per address", async () => {
    const c = fresh();
    const ip = { "cf-connecting-ip": "203.0.113.9" };
    const send = (n: number) => c.req("/api/auth/email-otp/send-verification-otp", { headers: ip, body: { email: `person${n}@acmefreight.example`, type: "sign-in" } });
    expect([(await send(1)).status, (await send(2)).status, (await send(3)).status]).toEqual([200, 200, 200]);
    expect((await send(4)).status).toBe(429);
  });

  it("in production (https APP_URL) the cookie is Secure with the __Secure- prefix and still resolves the tenant", async () => {
    const env = makeTestEnv({ APP_URL: "https://probity.pages.dev" });
    const c = new Client(makeApp(), env);
    const res = await c.signIn("controller@acmefreight.example");
    const cookie = res.headers.getSetCookie().join(";");
    expect(cookie).toMatch(/__Secure-probity\.session_token=/);
    expect(cookie).toMatch(/Secure/);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//);
    expect(Me.parse((await c.json("/api/me")).body).user?.email).toBe("controller@acmefreight.example");
    expect((await c.json("/api/dev/outbox?to=controller@acmefreight.example")).status).toBe(404);
  });
});
