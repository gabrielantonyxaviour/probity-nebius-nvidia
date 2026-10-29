import { DEMO_ORG_ID } from "@probity/shared";
import { Hono } from "hono";
import { canSee, runOrg } from "./scope";
import { fail, type AppEnv, type Ctx } from "./util";

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;
const TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", eml: "text/plain; charset=utf-8" };

/** Keys: `orgs/<org>/...` belong to a company, `pages/<run>/n.png` to a run, and the flat `<request>.letter.pdf` keys are the demo company's. */
async function allowed(c: Ctx, key: string): Promise<boolean> {
  const org = /^orgs\/([A-Za-z0-9_-]+)\//.exec(key)?.[1];
  if (org) {
    if (org === DEMO_ORG_ID && /\/uploads\//.test(key)) return uploadVisible(c, key);
    return canSee(c, org);
  }
  const run = /^pages\/([A-Za-z0-9_-]+)\//.exec(key)?.[1];
  if (run) return !!(await runOrg(c, run));
  return true; // flat demo fixtures
}

async function uploadVisible(c: Ctx, key: string): Promise<boolean> {
  const id = /\/uploads\/([A-Za-z0-9-]+)\//.exec(key)?.[1];
  if (!id) return false;
  const row = await c.env.DB.prepare("SELECT session_id FROM requests WHERE id = ?1").bind(id).first<{ session_id: string | null }>();
  return !!row && row.session_id === c.get("sid");
}

export const fileRoutes = new Hono<AppEnv>().get("/api/files/:key{.+}", async (c) => {
  const key = c.req.param("key");
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) return fail(c, 400, "That file name is not valid.", "bad_key");
  if (!(await allowed(c, key))) return fail(c, 404, "File not found.", "not_found");
  const obj = await c.env.FILES.get(key);
  if (!obj) return fail(c, 404, "File not found.", "not_found");
  const type = TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
  return new Response(obj.body, {
    headers: { "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-disposition": "inline" },
  });
});
