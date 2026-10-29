// Nebius AI Cloud from a Worker: service-account JWT (RS256 via WebCrypto) -> IAM token (cached in KV) -> Serverless Jobs REST.
import { z } from "zod";

export const NEBIUS_API = "https://api.nebius.cloud";
export const NEBIUS_TOKEN_URL = "https://auth.eu.nebius.com/oauth2/token/exchange";
/** Nebius's edge rejects requests with no recognisable client; every call names itself. */
export const UA = { "User-Agent": "probity-engine/1.0 (+https://probity.pages.dev)" };
export const DEFAULT_PROJECT_ID = "project-e04yk83jbc00bwhyv60mbp";
const TOKEN_KV_KEY = "nebius:iam-token:v1";
const TOKEN_KV_TTL_S = 11 * 60 * 60; // the token lives 12 h

export type NebiusEnv = { CACHE: KVNamespace; NEBIUS_SA_CREDENTIALS: string; NEBIUS_PROJECT_ID?: string };

const Credentials = z.object({ "subject-credentials": z.object({ alg: z.literal("RS256"), iss: z.string(), sub: z.string(), kid: z.string(), "private-key": z.string() }) });
export type SaKey = { iss: string; sub: string; kid: string; privateKeyPem: string };

export function parseCredentials(json: string): SaKey {
  const c = Credentials.parse(JSON.parse(json))["subject-credentials"];
  return { iss: c.iss, sub: c.sub, kid: c.kid, privateKeyPem: c["private-key"] };
}

const b64url = (bytes: ArrayBuffer | Uint8Array): string => {
  const u = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  let s = "";
  for (const b of u) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};
const enc = (o: unknown): string => b64url(new TextEncoder().encode(JSON.stringify(o)));

function pemToDer(pem: string): ArrayBuffer {
  const body = pem.replace(/-----(BEGIN|END)[A-Z ]+-----/g, "").replace(/\s+/g, "");
  const bin = atob(body);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

/** A signed RS256 JWT for the token exchange: kid = key id, iss = sub = service account id, exp at most 5 minutes out. */
export async function signJwt(key: SaKey, nowSec = Math.floor(Date.now() / 1000), lifetimeSec = 240): Promise<string> {
  const priv = await crypto.subtle.importKey("pkcs8", pemToDer(key.privateKeyPem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const head = enc({ alg: "RS256", typ: "JWT", kid: key.kid });
  const claims = enc({ iss: key.iss, sub: key.sub, iat: nowSec, exp: nowSec + Math.min(lifetimeSec, 300) });
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", priv, new TextEncoder().encode(`${head}.${claims}`));
  return `${head}.${claims}.${b64url(sig)}`;
}

/** First 200 characters of an error body, for the (HMAC-protected) start route. Nebius error bodies carry no credentials. */
const excerpt = async (res: Response): Promise<string> => (await res.text().catch(() => "")).replace(/\s+/g, " ").slice(0, 200);

/** Runs one Nebius call; a timeout or network failure names the stage so the operator sees which hop failed. */
async function staged(stage: string, call: () => Promise<Response>): Promise<Response> {
  const t0 = Date.now();
  try {
    return await call();
  } catch (e) {
    throw new Error(`${stage} ${e instanceof Error ? e.name : "failed"} after ${Date.now() - t0} ms`);
  }
}

/** Timed probes of the two Nebius hops, for the signed /sweep/diag route: no credentials are sent. */
export async function probeNebius(fetcher: typeof fetch = fetch): Promise<Array<{ hop: string; status: number | null; ms: number; note: string }>> {
  const hops: Array<[string, string, RequestInit]> = [
    ["token endpoint", NEBIUS_TOKEN_URL, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=urn:ietf:params:oauth:grant-type:token-exchange&subject_token=x.y.z&subject_token_type=urn:ietf:params:oauth:token-type:jwt" }],
    ["api jobs (no token)", `${NEBIUS_API}/ai/v1/jobs`, { headers: UA }],
    ["api jobs (no UA)", `${NEBIUS_API}/ai/v1/jobs`, {}],
  ];
  return Promise.all(hops.map(async ([hop, url, init]) => {
    const t0 = Date.now();
    try {
      const res = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) });
      return { hop, status: res.status, ms: Date.now() - t0, note: (await res.text()).replace(/\s+/g, " ").slice(0, 120) };
    } catch (e) {
      return { hop, status: null, ms: Date.now() - t0, note: e instanceof Error ? e.name : "failed" };
    }
  }));
}

const TokenResponse = z.object({ access_token: z.string(), expires_in: z.number().optional() });

/** IAM access token for the shared service account; cached in KV for 11 of its 12 hours. Throws on failure (callers catch). */
export async function getIamToken(env: NebiusEnv, fetcher: typeof fetch = fetch): Promise<string> {
  const hit = await env.CACHE.get(TOKEN_KV_KEY);
  if (hit) return hit;
  const jwt = await signJwt(parseCredentials(env.NEBIUS_SA_CREDENTIALS));
  const body = new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:token-exchange", requested_token_type: "urn:ietf:params:oauth:token-type:access_token", subject_token: jwt, subject_token_type: "urn:ietf:params:oauth:token-type:jwt" });
  const res = await staged("token exchange", () => fetcher(NEBIUS_TOKEN_URL, { method: "POST", headers: { ...UA, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body, signal: AbortSignal.timeout(25_000) }));
  if (!res.ok) throw new Error(`Nebius token exchange failed (${res.status}): ${await excerpt(res)}`);
  const token = TokenResponse.parse(await res.json()).access_token;
  await env.CACHE.put(TOKEN_KV_KEY, token, { expirationTtl: TOKEN_KV_TTL_S });
  return token;
}

export type JobFile = { containerPath: string; content: string };
export type JobEnvVar = { name: string; value: string } | { name: string; secretId: string; versionId?: string };
export type JobRequest = { name: string; files: JobFile[]; env: JobEnvVar[]; command: string; args: string; timeoutSeconds?: number };

export function jobBody(req: JobRequest, projectId: string): unknown {
  const b64 = (s: string): string => {
    const bytes = new TextEncoder().encode(s);
    if (bytes.length > 64 * 1024) throw new Error(`injected file too large (${bytes.length} bytes)`);
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin);
  };
  return {
    metadata: { parentId: projectId, name: req.name },
    spec: {
      image: "python:3.12-slim",
      containerCommand: req.command,
      args: req.args,
      platform: "cpu-d3",
      preset: "2vcpu-8gb",
      timeout: `${req.timeoutSeconds ?? 3600}s`,
      disk: { type: "NETWORK_SSD", sizeBytes: String(20 * 1024 ** 3) },
      injectedFiles: req.files.map((f) => ({ containerPath: f.containerPath, content: b64(f.content) })),
      // A SecretStash (MysteryBox) reference keeps the value out of the job spec; a plain value is the interim path.
      environmentVariables: req.env.map((e) => ("secretId" in e ? { name: e.name, mysteryboxSecret: { secretId: e.secretId, ...(e.versionId ? { versionId: e.versionId } : {}) } } : { name: e.name, value: e.value })),
    },
  };
}

const Operation = z.object({ resourceId: z.string().optional(), resource_id: z.string().optional(), id: z.string().optional() }).passthrough();
const JobState = z.object({ metadata: z.object({ id: z.string() }).passthrough(), status: z.object({ state: z.string().optional(), startedAt: z.string().optional(), finishedAt: z.string().optional() }).passthrough().optional() }).passthrough();
export type JobStatus = { id: string; state: string; startedAt: string | null; finishedAt: string | null };

export async function createJob(env: NebiusEnv, req: JobRequest, fetcher: typeof fetch = fetch): Promise<{ jobId: string }> {
  const token = await getIamToken(env, fetcher);
  const res = await staged("job create", () => fetcher(`${NEBIUS_API}/ai/v1/jobs`, { method: "POST", headers: { ...UA, Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(jobBody(req, env.NEBIUS_PROJECT_ID || DEFAULT_PROJECT_ID)), signal: AbortSignal.timeout(45_000) }));
  if (!res.ok) throw new Error(`Nebius job create failed (${res.status}): ${await excerpt(res)}`);
  const op = Operation.parse(await res.json());
  const jobId = op.resourceId ?? op.resource_id;
  if (!jobId) throw new Error("Nebius job create returned no resource id");
  return { jobId };
}

export async function getJob(env: NebiusEnv, jobId: string, fetcher: typeof fetch = fetch): Promise<JobStatus> {
  const token = await getIamToken(env, fetcher);
  const res = await staged("job read", () => fetcher(`${NEBIUS_API}/ai/v1/jobs/${encodeURIComponent(jobId)}`, { headers: { ...UA, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) }));
  if (!res.ok) throw new Error(`Nebius job read failed (${res.status}): ${await excerpt(res)}`);
  const j = JobState.parse(await res.json());
  return { id: j.metadata.id, state: j.status?.state ?? "STATE_UNSPECIFIED", startedAt: j.status?.startedAt ?? null, finishedAt: j.status?.finishedAt ?? null };
}
