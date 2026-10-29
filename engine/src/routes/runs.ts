import { LogOutcome, Run } from "@probity/shared";
import { Hono } from "hono";
import { logOutcome } from "../check/outcome";
import { actor, runOrg } from "./scope";
import { fail, type AppEnv } from "./util";

const ID = /^[A-Za-z0-9_-]{3,64}$/;

export const runRoutes = new Hono<AppEnv>()
  // Recorded runs (live = 0) are served as they are: no model call, no cost.
  .get("/api/runs/:id", async (c) => {
    const id = c.req.param("id");
    if (!ID.test(id)) return fail(c, 400, "That run id is not valid.", "bad_id");
    if (!(await runOrg(c, id))) return fail(c, 404, "Run not found.", "not_found");
    const row = await c.env.DB.prepare("SELECT json FROM runs WHERE id = ?1").bind(id).first<{ json: string }>();
    const parsed = Run.safeParse(row ? JSON.parse(row.json) : null);
    return parsed.success ? c.json(parsed.data) : fail(c, 500, "This run could not be read.", "bad_run");
  })
  .post("/api/runs/:id/outcome", actor, async (c) => {
    const id = c.req.param("id");
    if (!ID.test(id)) return fail(c, 400, "That run id is not valid.", "bad_id");
    const body = LogOutcome.safeParse(await c.req.json().catch(() => null));
    if (!body.success) return fail(c, 400, "The outcome must be confirmed, denied or no_answer, with an optional note.", "bad_request");
    const r = await logOutcome(c.env, c.get("orgId"), id, body.data.result, "AP clerk", body.data.note);
    if (r.ok) return c.json(r.run);
    if (r.code === "not_found") return fail(c, 404, "Run not found.", "not_found");
    if (r.code === "not_finished") return fail(c, 409, "The check has not finished, so there is nothing to log yet.", "not_finished");
    return fail(c, 500, "This run could not be read.", "bad_run");
  });
