// Shared test harness: a Hono app wired like the engine (tenant context faked), and a router for stubbed outbound fetches.
import { Hono } from "hono";
import { vi } from "vitest";
import { setResolved, type Role } from "../../src/auth/guards";
import { integrationRoutes } from "../../src/integrations";
import type { AppEnv } from "../../src/routes/util";
import { makeEnv, type FakeEnv } from "../evidence/fake-env";

export function appFor(orgId: string, role: Role = "owner"): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    const signedIn = role !== "viewer";
    setResolved(c, { user: signedIn ? { id: "u1", email: "owner@acme.test", name: "Owner" } : null, orgId, role, sessionId: null });
    c.set("orgId", orgId);
    c.set("userId", signedIn ? "u1" : null);
    c.set("sid", "sess-test");
    await next();
  });
  app.route("/api", integrationRoutes);
  return app;
}

export type Route = (url: URL, init: RequestInit | undefined, body: any) => unknown | Response | undefined;
/** Stubs global fetch with ordered routes; unmatched calls fail the test loudly. Returns the call log. */
export function stubFetch(routes: Route[]): Array<{ method: string; url: string; body: any }> {
  const log: Array<{ method: string; url: string; body: any }> = [];
  vi.stubGlobal("fetch", vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    let body: any = undefined;
    if (typeof init?.body === "string") { try { body = JSON.parse(init.body); } catch { body = init.body; } }
    log.push({ method: init?.method ?? "GET", url: url.toString(), body });
    for (const r of routes) {
      const out = r(url, init, body);
      if (out instanceof Response) return out;
      if (out !== undefined) return new Response(JSON.stringify(out), { status: 200, headers: { "Content-Type": "application/json" } });
    }
    throw new Error(`unstubbed fetch ${init?.method ?? "GET"} ${url}`);
  }));
  return log;
}
export const path = (url: URL): string => url.pathname.replace("/api/v3.1", "");
export { makeEnv, type FakeEnv };
