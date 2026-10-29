import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { Me } from "@probity/shared";
import { authRoutes, isDemo, requireMember, tenant } from "../../src/auth";
import type { AppEnv } from "../../src/routes/util";
import { Client, makeApp, makeTestEnv } from "./helpers";

function guarded() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, n) => { c.set("sid", "s"); await n(); });
  app.use("*", tenant);
  app.route("/api", authRoutes);
  app.get("/api/member", requireMember("member"), (c) => c.json({ ok: true, demo: isDemo(c) }));
  app.get("/api/admin", requireMember("admin"), (c) => c.json({ ok: true }));
  app.get("/api/owner", requireMember("owner"), (c) => c.json({ ok: true }));
  app.get("/api/public", (c) => c.json({ demo: isDemo(c) }));
  return app as unknown as ReturnType<typeof makeApp>;
}

describe("requireMember and isDemo", () => {
  it("signed out: 401 on guarded routes, demo true on open ones", async () => {
    const c = new Client(guarded(), makeTestEnv());
    expect((await c.json("/api/member")).status).toBe(401);
    expect((await c.json("/api/member")).body).toEqual({ error: "Sign in to do that.", code: "unauthenticated" });
    expect((await c.json("/api/public")).body).toEqual({ demo: true });
  });
  it("signed in without a company is not a member of the demo company", async () => {
    const c = new Client(guarded(), makeTestEnv());
    await c.signIn("visitor@acmefreight.example");
    expect((await c.json("/api/member")).status).toBe(403);
  });
  it("orders owner > admin > member", async () => {
    const env = makeTestEnv();
    const c = new Client(guarded(), env);
    await c.signIn("lead@acmefreight.example");
    const me = Me.parse((await c.json("/api/workspaces", { body: { name: "Acme Freight Ltd" } })).body);
    for (const [role, member, admin, owner] of [["owner", 200, 200, 200], ["admin", 200, 200, 403], ["member", 200, 403, 403], ["admin,member", 200, 200, 403]] as const) {
      await env.DB.prepare("UPDATE member SET role = ? WHERE organizationId = ?").bind(role, me.org.id).run();
      expect([role, (await c.json("/api/member")).status, (await c.json("/api/admin")).status, (await c.json("/api/owner")).status]).toEqual([role, member, admin, owner]);
    }
    expect((await c.json("/api/public")).body).toEqual({ demo: false });
  });
});
