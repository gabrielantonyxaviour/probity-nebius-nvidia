import { RequestDetail } from "@probity/shared";
import { Hono } from "hono";
import { getRequest, listInbox, RequestNotFoundError } from "../evidence";
import { fail, type AppEnv } from "./util";

const ID = /^[A-Za-z0-9-]{3,40}$/;

export const inboxRoutes = new Hono<AppEnv>()
  .get("/api/inbox", async (c) => c.json(await listInbox(c.env)))
  .get("/api/requests/:id", async (c) => {
    const id = c.req.param("id");
    if (!ID.test(id)) return fail(c, 400, "That request id is not valid.", "bad_id");
    try {
      const { emlText: _eml, ...detail } = await getRequest(c.env, id);
      return c.json(RequestDetail.parse(detail));
    } catch (e) {
      if (e instanceof RequestNotFoundError) return fail(c, 404, "Request not found.", "not_found");
      throw e;
    }
  });
