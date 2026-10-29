// Test doubles for the Workers bindings: D1 on node:sqlite (real SQL, the real migration and seed), an in-memory KV and R2.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const engineRoot = join(dirname(fileURLToPath(import.meta.url)), "../..");

class Stmt {
  constructor(private db: DatabaseSync, private sql: string, private args: unknown[] = []) {}
  bind(...args: unknown[]): Stmt { return new Stmt(this.db, this.sql, args); }
  private params(): never[] { return this.args.map((a) => (a === undefined ? null : a)) as never[]; }
  async first<T>(): Promise<T | null> { return (this.db.prepare(this.sql).get(...this.params()) as T | undefined) ?? null; }
  async all<T>(): Promise<{ results: T[]; success: true; meta: Record<string, unknown> }> { return { results: this.db.prepare(this.sql).all(...this.params()) as T[], success: true, meta: {} }; }
  async run(): Promise<{ success: true; meta: { changes: number } }> { const r = this.db.prepare(this.sql).run(...this.params()); return { success: true, meta: { changes: Number(r.changes) } }; }
}
export class FakeD1 {
  readonly raw = new DatabaseSync(":memory:");
  prepare(sql: string): Stmt { return new Stmt(this.raw, sql); }
  async batch(stmts: Stmt[]): Promise<unknown[]> { return Promise.all(stmts.map((s) => s.run())); }
  exec(sql: string): void { this.raw.exec(sql); }
}
export class FakeKV {
  readonly store = new Map<string, string>();
  puts = 0;
  async get<T>(key: string, type?: string): Promise<T | string | null> {
    const v = this.store.get(key);
    if (v === undefined) return null;
    return type === "json" ? (JSON.parse(v) as T) : v;
  }
  async put(key: string, value: string): Promise<void> { this.puts++; this.store.set(key, value); }
  async delete(key: string): Promise<void> { this.store.delete(key); }
}
export class FakeR2 {
  readonly store = new Map<string, string>();
  async get(key: string): Promise<{ text(): Promise<string> } | null> { const v = this.store.get(key); return v === undefined ? null : { text: async () => v }; }
}

export type FakeEnv = { DB: D1Database; CACHE: KVNamespace; FILES: R2Bucket; SEC_USER_AGENT: string; TAVILY_API_KEY: string; NEBIUS_API_KEY: string; NEBIUS_SA_CREDENTIALS: string; JOB_CALLBACK_SECRET: string; APP_URL: string; COMPOSIO_API_KEY: string; SLACK_CLIENT_ID: string; SLACK_CLIENT_SECRET: string; SLACK_SIGNING_SECRET: string; XERO_CLIENT_ID: string; XERO_CLIENT_SECRET: string; d1: FakeD1; kv: FakeKV; r2: FakeR2 };

/** A fresh environment with the schema applied; `seed: true` also loads the vendor master and the inbox. */
export function makeEnv(opts: { seed?: boolean } = {}): FakeEnv {
  const d1 = new FakeD1();
  for (const f of readdirSync(join(engineRoot, "migrations")).filter((n) => n.endsWith(".sql")).sort()) d1.exec(readFileSync(join(engineRoot, "migrations", f), "utf8"));
  if (opts.seed) d1.exec(readFileSync(join(engineRoot, "seed/seed.sql"), "utf8"));
  const kv = new FakeKV();
  const r2 = new FakeR2();
  if (opts.seed) {
    const fixtures = join(engineRoot, "../fixtures/requests");
    r2.store.set("BCR-2026-0412.headers.eml", readFileSync(join(fixtures, "BCR-2026-0412/headers.eml"), "utf8"));
  }
  return { DB: d1 as unknown as D1Database, CACHE: kv as unknown as KVNamespace, FILES: r2 as unknown as R2Bucket, SEC_USER_AGENT: "Probity vendor checks test@example.com", TAVILY_API_KEY: "tvly-test", NEBIUS_API_KEY: "test", NEBIUS_SA_CREDENTIALS: "{}", JOB_CALLBACK_SECRET: "test-secret", APP_URL: "https://probity.test", COMPOSIO_API_KEY: "ck_test", SLACK_CLIENT_ID: "111.222", SLACK_CLIENT_SECRET: "slack-secret", SLACK_SIGNING_SECRET: "slack-signing", XERO_CLIENT_ID: "xero-id", XERO_CLIENT_SECRET: "xero-secret", d1, kv, r2 };
}
