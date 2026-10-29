// Thin stand-ins for modules other agents are still landing. Delete each when the real export exists.
import type { Env } from "../env";

/** Sonnet B's Slack/e-mail notification when a run ends (`notifyRunFinished`). */
export async function notifyRunFinished(_env: Env, _orgId: string, _runId: string): Promise<void> {}
