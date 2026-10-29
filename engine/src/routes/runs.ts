import { LogOutcome, Run } from "@probity/shared";
import { Hono } from "hono";
import { applyOutcome } from "../policy/gate";
import { fail, type AppEnv } from "./util";

const ID = /^[A-Za-z0-9_-]{3,64}$/;

async function loadRun(db: D1Database, id: string): Promise<{ run: Run; live: boolean } | "bad" | null> {
  const row = await db.prepare("SELECT json, live FROM runs WHERE id = ?1").bind(id).first<{ json: string; live: number }>();
  if (!row) return null;
  const parsed = Run.safeParse(JSON.parse(row.json));
  return parsed.success ? { run: parsed.data, live: row.live === 1 } : "bad";
}

export const runRoutes = new Hono<AppEnv>()
  // Recorded runs (live = 0) are served as they are: no model call, no cost.
  .get("/api/runs/:id", async (c) => {
    const id = c.req.param("id");
    if (!ID.test(id)) return fail(c, 400, "That run id is not valid.", "bad_id");
    const r = await loadRun(c.env.DB, id);
    if (r === null) return fail(c, 404, "Run not found.", "not_found");
    if (r === "bad") return fail(c, 500, "This run could not be read.", "bad_run");
    return c.json(r.run);
  })
  .post("/api/runs/:id/outcome", async (c) => {
    const id = c.req.param("id");
    if (!ID.test(id)) return fail(c, 400, "That run id is not valid.", "bad_id");
    const body = LogOutcome.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return fail(c, 400, "The outcome must be confirmed, denied or no_answer, with an optional note.", "bad_request");
    const r = await loadRun(c.env.DB, id);
    if (r === null) return fail(c, 404, "Run not found.", "not_found");
    if (r === "bad") return fail(c, 500, "This run could not be read.", "bad_run");
    const { run, live } = r;
    if (run.status !== "done" || !run.decision) return fail(c, 409, "The check has not finished, so there is nothing to log yet.", "not_finished");
    const outcome = { result: body.data.result, by: "AP clerk", at: new Date().toISOString(), note: body.data.note };
    const updated: Run = { ...run, decision: applyOutcome(run.decision, outcome) };
    // A recorded run is shared by every visitor: show the effect, store nothing.
    if (!live) return c.json(updated);
    await c.env.DB.batch([
      c.env.DB.prepare("UPDATE runs SET json = ?2, updated_at = ?3 WHERE id = ?1").bind(id, JSON.stringify(updated), outcome.at),
      c.env.DB.prepare("UPDATE requests SET outcome = ?2, status = ?3 WHERE id = ?1").bind(run.requestId, outcome.result, outcome.result === "no_answer" ? "checked" : "closed"),
    ]);
    return c.json(updated);
  });
