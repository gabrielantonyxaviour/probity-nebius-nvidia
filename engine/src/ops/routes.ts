// /api/limits and /api/sweep/*. The two job endpoints (work, callback) and start accept only HMAC-signed requests.
import { Hono, type Context } from "hono";
import { z } from "zod";
import { getLimits, type GuardEnv } from "./guard";
import { verifyRequest } from "./hmac";
import { probeNebius } from "./nebius";
import { CallbackBody, latestSweep, startSweep, storeCallback, type OpsEnv } from "./sweep";
import { sweepWork } from "./work";

type Ctx = Context<{ Bindings: OpsEnv }>;
const StartBody = z.object({ mode: z.enum(["sweep", "eval"]).default("sweep") });
const safeJson = (t: string): unknown => { try { return JSON.parse(t); } catch { return null; } };
const fail = (c: Ctx, status: 400 | 401 | 500 | 502, error: string, code: string): Response => c.json({ error, code }, status);

/** Session identity: the `x-probity-session` header, else the `probity_sid` cookie, else a shared "anon" session. */
export function defaultSessionId(c: Ctx): string {
  const h = c.req.header("x-probity-session");
  if (h && /^[\w-]{6,64}$/.test(h)) return h;
  const m = /(?:^|;\s*)probity_sid=([\w-]{6,64})/.exec(c.req.header("cookie") ?? "");
  return m?.[1] ?? "anon";
}

async function signed(c: Ctx, body: string): Promise<boolean> {
  // The web Worker's /api proxy forwards only a fixed list of headers, so the signature may also ride in the query (?pts=&psig=).
  const url = new URL(c.req.url);
  const ts = c.req.header("x-probity-timestamp") ?? url.searchParams.get("pts") ?? undefined;
  const sig = c.req.header("x-probity-signature") ?? url.searchParams.get("psig") ?? undefined;
  return verifyRequest(c.env.JOB_CALLBACK_SECRET, c.req.method, url.pathname, body, ts, sig);
}

export function makeOpsRoutes(sessionOf: (c: Ctx) => string = defaultSessionId): Hono<{ Bindings: OpsEnv }> {
  const app = new Hono<{ Bindings: OpsEnv }>();

  app.get("/limits", async (c) => c.json(await getLimits(c.env as GuardEnv, sessionOf(c))));

  app.get("/sweep/latest", async (c) => c.json(await latestSweep(c.env)));

  app.get("/sweep/work", async (c) => {
    if (!(await signed(c, ""))) return fail(c, 401, "Signature missing or invalid.", "unauthorized");
    return c.json({ requests: await sweepWork(c.env) });
  });

  app.post("/sweep/callback", async (c) => {
    const raw = await c.req.text();
    if (!(await signed(c, raw))) return fail(c, 401, "Signature missing or invalid.", "unauthorized");
    let json: unknown;
    try { json = JSON.parse(raw); } catch { return fail(c, 400, "Body is not JSON.", "bad_request"); }
    const parsed = CallbackBody.safeParse(json);
    if (!parsed.success) return fail(c, 400, "Report does not match the expected shape.", "bad_request");
    return c.json(await storeCallback(c.env, parsed.data));
  });

  app.post("/sweep/diag", async (c) => {
    if (!(await signed(c, await c.req.text()))) return fail(c, 401, "Signature missing or invalid.", "unauthorized");
    return c.json({ hops: await probeNebius() });
  });

  app.post("/sweep/start", async (c) => {
    const raw = await c.req.text();
    if (!(await signed(c, raw))) return fail(c, 401, "Signature missing or invalid.", "unauthorized");
    const parsed = StartBody.safeParse(raw ? safeJson(raw) : {});
    if (!parsed.success) return fail(c, 400, "Body must be {\"mode\":\"sweep\"|\"eval\"}.", "bad_request");
    try {
      return c.json(await startSweep(c.env, parsed.data.mode));
    } catch (e) {
      // Reached only with a valid signature, so the cause may be shown to the operator.
      const detail = e instanceof Error ? `${e.name}: ${e.message}`.slice(0, 300) : "unknown";
      return c.json({ error: "The sweep job could not be started.", code: "job_start_failed", detail }, 502);
    }
  });

  return app;
}

export const opsRoutes = makeOpsRoutes();
