import { DEMO_ORG_ID, InboxItem, RequestDetail } from "@probity/shared";
import { Hono } from "hono";
import { getRequest, listInbox, RequestNotFoundError } from "../evidence";
import { requestRow } from "./scope";
import { fail, type AppEnv } from "./util";

const ID = /^[A-Za-z0-9-]{3,60}$/;

export const inboxRoutes = new Hono<AppEnv>()
  .get("/api/inbox", async (c) => {
    const org = c.get("orgId");
    // Only this company's requests; in the shared demo company a visitor's own uploads are theirs alone.
    const mine = await c.env.DB.prepare("SELECT id, source FROM requests WHERE org_id = ?1 AND (source != 'upload' OR ?1 != ?2 OR session_id = ?3)")
      .bind(org, DEMO_ORG_ID, c.get("sid"))
      .all<{ id: string; source: string }>();
    const source = new Map(mine.results.map((r) => [r.id, r.source]));
    const items = (await listInbox(c.env)).filter((i) => source.has(i.requestId));
    return c.json(items.map((i) => InboxItem.parse({ ...i, source: source.get(i.requestId) })));
  })
  .get("/api/requests/:id", async (c) => {
    const id = c.req.param("id");
    if (!ID.test(id)) return fail(c, 400, "That request id is not valid.", "bad_id");
    const row = await requestRow(c, id);
    if (!row) return fail(c, 404, "Request not found.", "not_found");
    try {
      const { emlText: _eml, ...detail } = await getRequest(c.env, id);
      return c.json(RequestDetail.parse({ ...detail, source: row.source }));
    } catch (e) {
      if (e instanceof RequestNotFoundError) return fail(c, 404, "Request not found.", "not_found");
      throw e;
    }
  });
