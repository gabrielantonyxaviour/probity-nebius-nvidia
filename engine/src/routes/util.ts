import type { ApiError } from "@probity/shared";
import type { Context } from "hono";
import type { Env } from "../env";

export type AppEnv = { Bindings: Env; Variables: { sid: string } };
export type Ctx = Context<AppEnv>;

/** Every error body is { error, code? }: plain words, never a stack or a database message. */
export function fail(c: Ctx, status: 400 | 404 | 409 | 413 | 415 | 422 | 429 | 500 | 502 | 503, error: string, code?: string) {
  const body: ApiError = code ? { error, code } : { error };
  return c.json(body, status);
}

export const GUARD_TEXT: Record<string, string> = {
  cap_reached: "Today's live checks have all been used. Recorded checks are still available.",
  session_cap: "You have used your live checks for this visit. Recorded checks are still available.",
  stopped: "Live checks are switched off for now. Recorded checks are still available.",
};
