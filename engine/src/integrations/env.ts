// The integrations module reads the engine's Env directly (Composio, Xero and Slack secrets are optional fields on it).
import type { Env } from "../env";

export type IntEnv = Env;
export const DEFAULT_APP_URL = "https://probity.pages.dev";
export const appUrl = (env: Pick<Env, "APP_URL">): string => (env.APP_URL || DEFAULT_APP_URL).replace(/\/$/, "");
export const nowIso = (): string => new Date().toISOString();
