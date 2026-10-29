// Starting a live check: spend guard, run row, Workflow. Shared by /api/checks and /api/checks/upload.
import { StartCheck } from "@probity/shared";
import { Hono } from "hono";
import { newRun } from "../check/run";
import type { Env } from "../env";
import { getRequest, RequestNotFoundError } from "../evidence";
import { guardLiveCheck } from "../ops";
import { refundLiveCheck } from "../ops/guard";
import { insertRun, setRequestState } from "../workflow/d1store";
import { fail, GUARD_TEXT, type AppEnv, type Ctx } from "./util";

export type Started = { ok: true; runId: string } | { ok: false; code: string };

/** Takes a live check from the caps, creates the run and starts the Workflow. Gives the check back if it cannot start. */
export async function startRun(env: Env, sessionId: string, requestId: string, vendorName: string): Promise<Started> {
  const guard = await guardLiveCheck(env, sessionId);
  if (!guard.ok) return { ok: false, code: guard.code };
  const runId = `run-${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
  try {
    await insertRun(env.DB, newRun({ id: runId, requestId, vendorName, live: true }));
    await setRequestState(env.DB, requestId, { status: "checking", latestRunId: runId });
    await env.CHECK.create({ id: runId, params: { runId, sessionId } });
  } catch {
    await refundLiveCheck(env, sessionId);
    await env.DB.prepare("UPDATE runs SET status = 'failed' WHERE id = ?1").bind(runId).run().catch(() => undefined);
    return { ok: false, code: "start_failed" };
  }
  return { ok: true, runId };
}

export function startFailure(c: Ctx, code: string) {
  if (code === "start_failed") return fail(c, 503, "The check could not be started. Try again in a moment.", code);
  return fail(c, 429, GUARD_TEXT[code] ?? "Live checks are not available right now.", code);
}

export const startRoutes = new Hono<AppEnv>().post("/api/checks", async (c) => {
  const body = StartCheck.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return fail(c, 400, "Send { requestId } to start a check.", "bad_request");
  const { requestId } = body.data;
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
  const started = await startRun(c.env, c.get("sid"), requestId, vendorName);
  return started.ok ? c.json({ runId: started.runId }) : startFailure(c, started.code);
});
