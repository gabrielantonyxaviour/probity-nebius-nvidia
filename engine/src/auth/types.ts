// Bindings and vars the auth, billing and e-mail modules read, on top of the shared Env.
import type { Env } from "../env";

export interface ProductVars {
  /** Public origin of the app, e.g. https://probity.pages.dev. Requests reach the engine through the web Worker's proxy, so this is not the engine's own URL. */
  APP_URL: string;
  BETTER_AUTH_SECRET: string;
  /** Cloudflare Email Service send binding (wrangler `send_email`, name EMAIL). Absent until the sending domain is onboarded. */
  EMAIL?: SendEmail;
  /** "Probity <notifications@probity.larinova.com>"; must belong to an onboarded Email Service domain. Unset: local mail goes to the outbox table, deployed mail fails with email_unconfigured. */
  EMAIL_FROM?: string;
  DODO_PAYMENTS_API_KEY?: string;
  DODO_PAYMENTS_LIVE_API_KEY?: string;
  DODO_MODE?: string;
  DODO_WEBHOOK_SECRET?: string;
  JUDGE_CODE?: string;
}
export type CEnv = Env & ProductVars;

export const LOCAL_ORIGIN = "http://localhost:3200";
