// Who may see what. A signed-in company sees its own requests, runs and files; the demo company is readable by everyone.
import { DEMO_ORG_ID } from "@probity/shared";
import type { MiddlewareHandler } from "hono";
import { requireMember } from "../auth";
import type { AppEnv, Ctx } from "./util";

export const canSee = (c: Ctx, rowOrg: string | null | undefined): boolean => !!rowOrg && (rowOrg === c.get("orgId") || rowOrg === DEMO_ORG_ID);

export async function requestRow(c: Ctx, requestId: string): Promise<{ org_id: string; source: string; session_id: string | null } | null> {
  const row = await c.env.DB.prepare("SELECT org_id, source, session_id FROM requests WHERE id = ?1").bind(requestId).first<{ org_id: string; source: string; session_id: string | null }>();
  if (!row || !canSee(c, row.org_id)) return null;
  // A visitor's upload into the shared demo company is private to that visitor's session.
  if (row.org_id === DEMO_ORG_ID && row.source === "upload" && row.session_id !== c.get("sid")) return null;
  return row;
}

export async function runOrg(c: Ctx, runId: string): Promise<string | null> {
  const row = await c.env.DB.prepare("SELECT org_id FROM runs WHERE id = ?1").bind(runId).first<{ org_id: string }>();
  return row && canSee(c, row.org_id) ? row.org_id : null;
}

/** Starting checks and logging outcomes: anyone in the shared demo company, but only a member of a real company. */
export const actor: MiddlewareHandler<AppEnv> = (c, next) => (c.get("orgId") === DEMO_ORG_ID ? next() : requireMember("member")(c, next));
