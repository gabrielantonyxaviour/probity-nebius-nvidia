// POST /api/checks: start a live check on a request of the caller's company (or of the demo company).
import { StartCheck } from "@probity/shared";
import { Hono } from "hono";
import { startRun } from "../check/start";
import { getRequest, RequestNotFoundError } from "../evidence";
import { actor, requestRow } from "./scope";
import { fail, GUARD_TEXT, type AppEnv, type Ctx } from "./util";

export function startFailure(c: Ctx, code: string) {
  if (code === "start_failed") return fail(c, 503, "The check could not be started. Try again in a moment.", code);
  if (code === "plan_limit") return fail(c, 429, "This company has used its checks for the month. Upgrade to keep checking.", code);
  return fail(c, 429, GUARD_TEXT[code] ?? "Live checks are not available right now.", code);
}

export const startRoutes = new Hono<AppEnv>().post("/api/checks", actor, async (c) => {
  const body = StartCheck.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return fail(c, 400, "Send { requestId } to start a check.", "bad_request");
  const { requestId } = body.data;
  const row = await requestRow(c, requestId);
  if (!row) return fail(c, 404, "Request not found.", "not_found");
  let vendorName: string;
  try {
    vendorName = (await getRequest(c.env, requestId)).vendorName;
  } catch (e) {
    if (e instanceof RequestNotFoundError) return fail(c, 404, "Request not found.", "not_found");
    throw e;
  }
  // A double click returns the check already under way instead of spending another.
  const open = await c.env.DB.prepare("SELECT id FROM runs WHERE request_id = ?1 AND live = 1 AND status IN ('queued','running') AND created_at > ?2 ORDER BY created_at DESC LIMIT 1")
    .bind(requestId, new Date(Date.now() - 10 * 60_000).toISOString())
    .first<{ id: string }>();
  if (open) return c.json({ runId: open.id });
  const started = await startRun(c.env, c.get("sid"), row.org_id, requestId, vendorName);
  return started.ok ? c.json({ runId: started.runId }) : startFailure(c, started.code);
});
