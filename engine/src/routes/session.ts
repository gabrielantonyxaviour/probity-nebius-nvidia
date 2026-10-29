import { getCookie, setCookie } from "hono/cookie";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "./util";

const SID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Anonymous session id in the `pb_sid` cookie: it is what the per-visit live-check cap counts against. */
export const session: MiddlewareHandler<AppEnv> = async (c, next) => {
  let sid = getCookie(c, "pb_sid");
  if (!sid || !SID.test(sid)) {
    sid = crypto.randomUUID();
    setCookie(c, "pb_sid", sid, { httpOnly: true, sameSite: "Lax", path: "/", maxAge: 60 * 60 * 24 * 365, secure: new URL(c.req.url).protocol === "https:" });
  }
  c.set("sid", sid);
  await next();
};
