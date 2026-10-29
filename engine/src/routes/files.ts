import { Hono } from "hono";
import { fail, type AppEnv } from "./util";

const SAFE_KEY = /^[A-Za-z0-9][A-Za-z0-9._/-]{0,200}$/;
const TYPES: Record<string, string> = { pdf: "application/pdf", png: "image/png", jpg: "image/jpeg", eml: "text/plain; charset=utf-8" };

export const fileRoutes = new Hono<AppEnv>().get("/api/files/:key{.+}", async (c) => {
  const key = c.req.param("key");
  if (!SAFE_KEY.test(key) || key.includes("..") || key.includes("//")) return fail(c, 400, "That file name is not valid.", "bad_key");
  const obj = await c.env.FILES.get(key);
  if (!obj) return fail(c, 404, "File not found.", "not_found");
  const type = TYPES[key.split(".").pop()?.toLowerCase() ?? ""] ?? "application/octet-stream";
  return new Response(obj.body, {
    headers: { "content-type": type, "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff", "content-disposition": "inline" },
  });
});
