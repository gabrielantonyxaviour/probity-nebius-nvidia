// Worker bindings, secrets and vars. Secrets come from `wrangler secret` (deployed) or `.dev.vars` (local).
export interface Env {
  DB: D1Database;
  CACHE: KVNamespace;
  FILES: R2Bucket;
  CHECK: Workflow;
  NEBIUS_API_KEY: string;
  TAVILY_API_KEY: string;
  NEBIUS_SA_CREDENTIALS: string;
  JOB_CALLBACK_SECRET: string;
  SEC_USER_AGENT: string;
  /** Optional override of the Token Factory base URL (tests, proxies). */
  NEBIUS_BASE_URL?: string;
}
