// Auth module (Sonnet C): Better Auth at /api/auth/*, /api/me, /api/workspaces, and the tenant middleware.
import { Hono, type MiddlewareHandler } from "hono";
import { DEMO_ORG_ID, Me } from "@probity/shared";
import { z } from "zod";
import { effectivePlan, getProfile } from "../billing/plans";
import type { AppEnv, Ctx } from "../routes/util";
import { deny, getResolved, parseRole, setResolved, type Resolved, type Role } from "./guards";
import { makeAuth } from "./instance";
import { LOCAL_ORIGIN, type CEnv } from "./types";

export { requireMember, isDemo, type Role } from "./guards";
export { getPlan, checksLeft, consumeCheck } from "../billing/plans";

const SESSION_COOKIE = /(?:^|;\s*)(?:__Secure-)?probity\.session_token=/;
const cenv = (c: Ctx) => c.env as CEnv;
function background(c: Ctx) {
  return (p: Promise<unknown>) => {
    const safe = p.catch(() => undefined);
    try { c.executionCtx.waitUntil(safe); } catch { /* no execution context (tests): the promise still runs */ }
  };
}
const authFor = (c: Ctx) => makeAuth(cenv(c), background(c));

type DbUser = { id: string; email: string; name: string };
async function resolve(c: Ctx): Promise<Resolved> {
  const demo: Resolved = { user: null, orgId: DEMO_ORG_ID, role: "viewer", sessionId: null };
  if (!SESSION_COOKIE.test(c.req.header("cookie") ?? "")) return demo;
  let s: Awaited<ReturnType<ReturnType<typeof authFor>["api"]["getSession"]>>;
  try { s = await authFor(c).api.getSession({ headers: c.req.raw.headers }); } catch { return demo; }
  if (!s) return demo;
  const user = { id: s.user.id, email: s.user.email, name: s.user.name || null };
  const db = cenv(c).DB;
  const wanted = (s.session as { activeOrganizationId?: string | null }).activeOrganizationId ?? null;
  // The session's active company only counts if the user is still a member of it; otherwise fall back to their first one.
  const own = wanted ? await db.prepare("SELECT organizationId, role FROM member WHERE organizationId = ? AND userId = ?").bind(wanted, user.id).first<{ organizationId: string; role: string }>() : null;
  const m = own ?? (await db.prepare("SELECT organizationId, role FROM member WHERE userId = ? ORDER BY createdAt ASC LIMIT 1").bind(user.id).first<{ organizationId: string; role: string }>());
  if (!m) return { ...demo, user, sessionId: s.session.id };
  return { user, orgId: m.organizationId, role: parseRole(m.role), sessionId: s.session.id };
}

/** Signed in with a company: act as that company. Anyone else acts as the shared demo company. */
export const tenant: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (new URL(c.req.url).pathname.startsWith("/api/auth/")) { c.set("orgId", DEMO_ORG_ID); c.set("userId", null); return next(); }
  const r = await resolve(c);
  setResolved(c, r);
  const inCompany = r.user !== null && r.orgId !== DEMO_ORG_ID;
  c.set("orgId", r.orgId);
  c.set("userId", inCompany ? r.user!.id : null);
  await next();
};

async function buildMe(env: CEnv, user: Resolved["user"], orgId: string, role: Role): Promise<Me> {
  const org = await env.DB.prepare('SELECT id, name FROM organization WHERE id = ?').bind(orgId).first<{ id: string; name: string }>();
  const orgs = user
    ? (await env.DB.prepare('SELECT o.id AS id, o.name AS name FROM member m JOIN organization o ON o.id = m.organizationId WHERE m.userId = ? AND o.id != ? ORDER BY m.createdAt ASC').bind(user.id, DEMO_ORG_ID).all<{ id: string; name: string }>()).results
    : [];
  const plan = orgId === DEMO_ORG_ID ? "pro" : effectivePlan(await getProfile(env, orgId));
  return Me.parse({ user, org: { id: orgId, name: org?.name ?? "Workspace", isDemo: orgId === DEMO_ORG_ID, plan, role }, orgs });
}

const slugify = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40) || "workspace";
const CreateBody = z.object({ name: z.string().trim().min(2, "Give the company a name.").max(80) });
const SwitchBody = z.object({ orgId: z.string().min(1).max(100) });

export const authRoutes = new Hono<AppEnv>();

authRoutes.all("/auth/*", (c) => authFor(c).handler(c.req.raw));

authRoutes.get("/me", async (c) => {
  const r = getResolved(c);
  return c.json(await buildMe(cenv(c), r.user, r.orgId, r.role));
});

authRoutes.post("/workspaces", async (c) => {
  const r = getResolved(c);
  if (!r.user) return deny(c, 401, "Sign in to create a workspace.", "unauthenticated");
  const body = CreateBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? "Give the company a name.", code: "bad_request" }, 400);
  const auth = authFor(c);
  let orgId: string;
  try {
    const org = await auth.api.createOrganization({ headers: c.req.raw.headers, body: { name: body.data.name, slug: `${slugify(body.data.name)}-${crypto.randomUUID().slice(0, 5)}` } });
    if (!org) throw new Error("no organisation");
    orgId = org.id;
  } catch {
    return c.json({ error: "Could not create the workspace. You may have reached the limit of 5.", code: "workspace_failed" }, 409);
  }
  const env = cenv(c);
  await env.DB.prepare("INSERT OR IGNORE INTO org_profile (org_id, plan, plan_status, created_at) VALUES (?, 'free', 'none', ?)").bind(orgId, new Date().toISOString()).run();
  await env.DB.prepare("UPDATE session SET activeOrganizationId = ? WHERE id = ?").bind(orgId, r.sessionId).run();
  return c.json(await buildMe(env, r.user, orgId, "owner"), 201);
});

authRoutes.post("/workspaces/switch", async (c) => {
  const r = getResolved(c);
  if (!r.user) return deny(c, 401, "Sign in to switch workspaces.", "unauthenticated");
  const body = SwitchBody.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: "Choose a workspace.", code: "bad_request" }, 400);
  const env = cenv(c);
  const m = await env.DB.prepare("SELECT role FROM member WHERE organizationId = ? AND userId = ?").bind(body.data.orgId, r.user.id).first<{ role: string }>();
  if (!m) return deny(c, 403, "You are not a member of that workspace.", "forbidden");
  await env.DB.prepare("UPDATE session SET activeOrganizationId = ? WHERE id = ?").bind(body.data.orgId, r.sessionId).run();
  return c.json(await buildMe(env, r.user, body.data.orgId, parseRole(m.role)));
});

// Local development only: read the latest mail written to the outbox (sign-in codes) when no sending domain is set up.
authRoutes.get("/dev/outbox", async (c) => {
  const env = cenv(c);
  if (!(env.APP_URL.startsWith("http://localhost") || env.APP_URL === LOCAL_ORIGIN) || env.RESEND_API_KEY && env.EMAIL_FROM) return c.json({ error: "Not found.", code: "not_found" }, 404);
  const to = c.req.query("to") ?? "";
  const rows = await env.DB.prepare("SELECT to_addr, subject, text, created_at FROM email_outbox WHERE to_addr = ? ORDER BY id DESC LIMIT 5").bind(to).all();
  return c.json({ messages: rows.results });
});
