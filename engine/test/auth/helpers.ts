// Shared setup for the auth, billing and e-mail tests: the real migrations on a node:sqlite D1, an in-memory KV, and a small app.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Hono } from "hono";
import { authRoutes, tenant } from "../../src/auth";
import type { CEnv } from "../../src/auth/types";
import { billingRoutes } from "../../src/billing";
import type { AppEnv } from "../../src/routes/util";
import { FakeKV } from "../evidence/fake-env";
import { TestD1 } from "./d1";

const root = join(dirname(fileURLToPath(import.meta.url)), "../..");
export const MIGRATIONS = ["0001_init.sql", "0030_auth.sql", "0031_billing.sql", "0032_email.sql"];

export function makeTestEnv(over: Partial<CEnv> = {}): CEnv & { d1: TestD1 } {
  const d1 = new TestD1();
  for (const f of MIGRATIONS) d1.exec(readFileSync(join(root, "migrations", f), "utf8"));
  return {
    DB: d1 as unknown as D1Database,
    CACHE: new FakeKV() as unknown as KVNamespace,
    APP_URL: "http://localhost:3200",
    BETTER_AUTH_SECRET: "test-secret-test-secret-test-secret-123",
    JUDGE_CODE: "judge-open-sesame",
    DODO_WEBHOOK_SECRET: "whsec_" + btoa("webhook-test-secret-bytes-0123456789"),
    d1,
    ...over,
  } as unknown as CEnv & { d1: TestD1 };
}

export function makeApp() {
  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => { c.set("sid", "test-sid"); await next(); });
  app.use("*", tenant);
  app.route("/api", authRoutes);
  app.route("/api/billing", billingRoutes);
  app.get("/api/probe", (c) => c.json({ orgId: c.get("orgId"), userId: c.get("userId") }));
  return app;
}

export class Client {
  private jar = new Map<string, string>();
  constructor(public app: ReturnType<typeof makeApp>, public env: CEnv) {}
  async req(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}) {
    const headers: Record<string, string> = { origin: "http://localhost:3200", ...init.headers };
    if (init.body !== undefined) headers["content-type"] = "application/json";
    if (this.jar.size) headers.cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join("; ");
    const res = await this.app.request(`http://localhost:3200${path}`, { method: init.method ?? (init.body !== undefined ? "POST" : "GET"), headers, body: init.body === undefined ? undefined : JSON.stringify(init.body) }, this.env);
    for (const sc of res.headers.getSetCookie()) {
      const [pair] = sc.split(";");
      const i = pair!.indexOf("=");
      const name = pair!.slice(0, i), val = pair!.slice(i + 1);
      if (val === "" || /max-age=0/i.test(sc)) this.jar.delete(name); else this.jar.set(name, val);
    }
    return res;
  }
  async json<T = any>(path: string, init?: Parameters<Client["req"]>[1]) { const r = await this.req(path, init); return { status: r.status, body: (await r.json()) as T }; }
  /** Full sign-in through the real endpoints, reading the code from the e-mail outbox. */
  async signIn(email: string) {
    const send = await this.req("/api/auth/email-otp/send-verification-otp", { body: { email, type: "sign-in" } });
    if (send.status !== 200) throw new Error(`send failed ${send.status}`);
    const code = await lastCode(this.env, email);
    return this.req("/api/auth/sign-in/email-otp", { body: { email, otp: code } });
  }
}

export async function lastCode(env: CEnv, email: string): Promise<string> {
  for (let i = 0; i < 100; i++) {
    const row = await env.DB.prepare("SELECT text FROM email_outbox WHERE to_addr = ? ORDER BY id DESC LIMIT 1").bind(email).first<{ text: string }>();
    const m = row?.text.match(/code is (\d{6})/);
    if (m) return m[1]!;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error("no code in outbox");
}
