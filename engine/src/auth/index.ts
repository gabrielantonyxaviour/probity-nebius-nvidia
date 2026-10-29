// Auth module (Sonnet C): Better Auth at /api/auth/*, /api/me, /api/workspaces, and the tenant middleware.
// Placeholder until C lands it: everyone is in the demo company, nobody is signed in.
import { Hono, type MiddlewareHandler } from "hono";
import { DEMO_ORG_ID } from "@probity/shared";
import type { AppEnv } from "../routes/util";

export const tenant: MiddlewareHandler<AppEnv> = async (c, next) => {
  c.set("orgId", DEMO_ORG_ID);
  c.set("userId", null);
  await next();
};

export const authRoutes = new Hono<AppEnv>();
