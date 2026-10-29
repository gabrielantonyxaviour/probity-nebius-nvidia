// Who may change connections: owners and admins of a real company. The demo company is read-only.
import type { MiddlewareHandler } from "hono";
import { DEMO_ORG_ID } from "@probity/shared";
import { requireMember } from "../auth";
import type { AppEnv } from "../routes/util";

const admin = requireMember("admin");
export const requireAdmin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (c.get("orgId") === DEMO_ORG_ID) return c.json({ error: "Sign in and create your company to connect accounts.", code: "demo_readonly" }, 403);
  return admin(c, next);
};
