// Same-origin proxy: the browser only ever talks to this Worker, which forwards /api/* to the engine
// Worker over a service binding (no public engine address exists).
import { getCloudflareContext } from "@opennextjs/cloudflare";

type Ctx = { params: Promise<{ path: string[] }> };
type Engine = { fetch: (req: Request) => Promise<Response> };

const PASS_HEADERS = ["content-type", "cookie", "accept", "x-session", "x-probity-timestamp", "x-probity-signature"];

async function forward(req: Request, { params }: Ctx): Promise<Response> {
  const { path } = await params;
  if (!path.every((p) => /^[A-Za-z0-9._-]+$/.test(p))) {
    return Response.json({ error: "Bad path", code: "bad_path" }, { status: 400 });
  }
  const url = new URL(req.url);
  const target = `/api/${path.join("/")}${url.search}`;

  if (process.env.NODE_ENV !== "production" && process.env.PROBITY_MOCK === "1") {
    const { mockResponse } = await import("@/dev-fixtures/mock");
    return mockResponse(req, target);
  }

  const headers = new Headers();
  for (const h of PASS_HEADERS) {
    const v = req.headers.get(h);
    if (v) headers.set(h, v);
  }
  const init: RequestInit = { method: req.method, headers, redirect: "manual" };
  if (req.method !== "GET" && req.method !== "HEAD") init.body = await req.arrayBuffer();

  // Local development points at `wrangler dev` directly; deployed, the service binding is the only route.
  const base = process.env.ENGINE_URL;
  if (base) return clean(await fetch(`${base}${target}`, init));
  try {
    const { env } = await getCloudflareContext({ async: true });
    const engine = (env as unknown as { ENGINE?: Engine }).ENGINE;
    const res = engine ? await engine.fetch(new Request(`https://engine${target}`, init)) : undefined;
    if (res instanceof Response) return clean(res);
  } catch {
    // Binding unavailable: answer below.
  }
  return Response.json({ error: "The check service is not reachable", code: "engine_unavailable" }, { status: 503 });
}

/** fetch() has already decoded the body, so the encoding and length headers no longer describe it. */
function clean(res: Response): Response {
  const headers = new Headers(res.headers);
  headers.delete("content-encoding");
  headers.delete("content-length");
  return new Response(res.body, { status: res.status, statusText: res.statusText, headers });
}

export const GET = forward;
export const POST = forward;
