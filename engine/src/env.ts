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
  /** Public origin the browser sees (the Pages front), e.g. https://probity.pages.dev. */
  APP_URL: string;
  // Sign-in, e-mail and billing (auth, email and billing modules).
  BETTER_AUTH_SECRET: string;
  /** Cloudflare Email Service binding (sending domain probity.larinova.com). */
  EMAIL?: SendEmail;
  EMAIL_FROM?: string;
  DODO_PAYMENTS_API_KEY?: string;
  DODO_PAYMENTS_LIVE_API_KEY?: string;
  DODO_MODE?: "test" | "live";
  DODO_WEBHOOK_SECRET?: string;
  JUDGE_CODE?: string;
  // Integrations (Composio, Xero, our Slack app).
  COMPOSIO_API_KEY?: string;
  XERO_CLIENT_ID?: string;
  XERO_CLIENT_SECRET?: string;
  SLACK_CLIENT_ID?: string;
  SLACK_CLIENT_SECRET?: string;
  SLACK_SIGNING_SECRET?: string;
}
