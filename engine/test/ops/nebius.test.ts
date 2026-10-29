import { generateKeyPairSync, createVerify } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { createJob, getIamToken, jobBody, parseCredentials, signJwt } from "../../src/ops/nebius";
import { makeEnv } from "../evidence/fake-env";

// A throwaway key generated here. The real service-account key is never read by any test.
const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const pem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
const creds = JSON.stringify({ "subject-credentials": { alg: "RS256", type: "JWT", iss: "serviceaccount-test", sub: "serviceaccount-test", kid: "publickey-test", "private-key": pem } });
const b64 = (s: string): Buffer => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");

describe("Nebius service-account JWT", () => {
  it("builds an RS256 JWT with kid, iss = sub, exp within 5 minutes, signed by the key", async () => {
    const key = parseCredentials(creds);
    const jwt = await signJwt(key, 1_800_000_000);
    const [h, c, s] = jwt.split(".") as [string, string, string];
    expect(JSON.parse(b64(h).toString())).toEqual({ alg: "RS256", typ: "JWT", kid: "publickey-test" });
    const claims = JSON.parse(b64(c).toString()) as { iss: string; sub: string; exp: number; iat: number };
    expect(claims.iss).toBe("serviceaccount-test");
    expect(claims.sub).toBe("serviceaccount-test");
    expect(claims.exp - claims.iat).toBeLessThanOrEqual(300);
    const v = createVerify("RSA-SHA256").update(`${h}.${c}`);
    expect(v.verify(publicKey, b64(s))).toBe(true);
  });

  it("rejects credentials of the wrong shape", () => {
    expect(() => parseCredentials("{}")).toThrow();
  });

  it("exchanges the JWT once and serves the IAM token from KV afterwards", async () => {
    const env = { ...makeEnv(), NEBIUS_SA_CREDENTIALS: creds };
    const fetcher = vi.fn(async (_u: unknown, init?: RequestInit) => {
      const form = new URLSearchParams(String(init?.body));
      expect(form.get("grant_type")).toBe("urn:ietf:params:oauth:grant-type:token-exchange");
      expect(form.get("subject_token")?.split(".")).toHaveLength(3);
      return new Response(JSON.stringify({ access_token: "iam-token-1", expires_in: 43200 }), { status: 200 });
    }) as unknown as typeof fetch;
    expect(await getIamToken(env, fetcher)).toBe("iam-token-1");
    expect(await getIamToken(env, fetcher)).toBe("iam-token-1");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("creates a job with the documented body and returns the resource id", async () => {
    const env = { ...makeEnv(), NEBIUS_SA_CREDENTIALS: creds };
    env.kv.store.set("nebius:iam-token:v1", "iam-token-1");
    let sent: { url: string; auth: string | null; body: any } | null = null;
    const fetcher = vi.fn(async (u: unknown, init?: RequestInit) => {
      sent = { url: String(u), auth: new Headers(init?.headers).get("authorization"), body: JSON.parse(String(init?.body)) };
      return new Response(JSON.stringify({ id: "operation-1", resourceId: "aijob-abc" }), { status: 200 });
    }) as unknown as typeof fetch;
    const out = await createJob(env, { name: "probity-sweep-x", files: [{ containerPath: "/opt/probity/run.sh", content: "echo hi" }], env: [{ name: "MODE", value: "eval" }, { name: "NEBIUS_API_KEY", secretId: "mbsecret-1" }], command: "bash", args: "/opt/probity/run.sh" }, fetcher);
    expect(out.jobId).toBe("aijob-abc");
    const s = sent!;
    expect(s.url).toBe("https://api.nebius.cloud/ai/v1/jobs");
    expect(s.auth).toBe("Bearer iam-token-1");
    expect(s.body.metadata).toEqual({ parentId: "project-e04yk83jbc00bwhyv60mbp", name: "probity-sweep-x" });
    expect(s.body.spec).toMatchObject({ image: "python:3.12-slim", platform: "cpu-d3", preset: "2vcpu-8gb", timeout: "3600s", disk: { type: "NETWORK_SSD", sizeBytes: String(20 * 1024 ** 3) } });
    expect(Buffer.from(s.body.spec.injectedFiles[0].content, "base64").toString()).toBe("echo hi");
    expect(s.body.spec.environmentVariables[1]).toEqual({ name: "NEBIUS_API_KEY", mysteryboxSecret: { secretId: "mbsecret-1" } });
  });

  it("refuses an injected file over 64 KiB", () => {
    expect(() => jobBody({ name: "n", files: [{ containerPath: "/opt/x", content: "a".repeat(65 * 1024) }], env: [], command: "bash", args: "x" }, "project-1")).toThrow(/too large/);
  });
});
