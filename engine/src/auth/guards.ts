// Who is calling and in which role. tenant() resolves this once per request; requireMember() and /me read it.
import type { MiddlewareHandler } from "hono";
import { DEMO_ORG_ID } from "@probity/shared";
import type { AppEnv, Ctx } from "../routes/util";

export type Role = "owner" | "admin" | "member" | "viewer";
const RANK: Record<Role, number> = { viewer: 0, member: 1, admin: 2, owner: 3 };

export type Resolved = {
  user: { id: string; email: string; name: string | null } | null;
  orgId: string; // the company the request acts on (the demo company unless a member of a real one)
  role: Role;
  sessionId: string | null;
};
const resolved = new WeakMap<Request, Resolved>();
export const setResolved = (c: Ctx, r: Resolved) => void resolved.set(c.req.raw, r);
export const getResolved = (c: Ctx): Resolved => resolved.get(c.req.raw) ?? { user: null, orgId: DEMO_ORG_ID, role: "viewer", sessionId: null };

export const isDemo = (c: Ctx): boolean => c.get("orgId") === DEMO_ORG_ID;

/** Highest role in Better Auth's possibly comma-separated role string. */
export function parseRole(raw: string | null | undefined): Role {
  let best: Role = "viewer";
  for (const part of (raw ?? "").split(",").map((s) => s.trim())) {
    if ((part === "owner" || part === "admin" || part === "member") && RANK[part] > RANK[best]) best = part;
  }
  return best;
}

export const deny = (c: Ctx, status: 401 | 403, error: string, code: string) => c.json({ error, code }, status);

/** Route guard: the caller must be signed in with at least this role in the active company. The demo company never passes. */
export function requireMember(min: Exclude<Role, "viewer"> = "member"): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const r = getResolved(c);
    if (!r.user) return deny(c, 401, "Sign in to do that.", "unauthenticated");
    if (r.orgId === DEMO_ORG_ID || RANK[r.role] < RANK[min]) return deny(c, 403, min === "member" ? "You need to be a member of this workspace to do that." : `Only a workspace ${min === "admin" ? "admin or owner" : "owner"} can do that.`, "forbidden");
    await next();
  };
}
