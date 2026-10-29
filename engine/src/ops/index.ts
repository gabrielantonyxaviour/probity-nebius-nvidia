import type { Env } from "../env";
import { runDueRechecks } from "../integrations/schedule";
// Ops: spend guard, the Nebius NeMo Guardrails job's ingest routes, and the in-app rails. A mounts `opsRoutes` at /api.
export { guardLiveCheck, refundLiveCheck, getLimits, CAPS } from "./guard";
export { opsRoutes, makeOpsRoutes, defaultSessionId } from "./routes";
export { latestSweep, storeCallback, registerJob, type OpsEnv } from "./sweep";
export { railInput, railOutput, railsPass, parseRailAnswer } from "./rails";
export { sweepWork } from "./work";

/** Cron entry (every 5 minutes): the pre-run re-check for every company whose window has opened. */
export async function scheduled(_event: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
  ctx.waitUntil(runDueRechecks(env).then(() => undefined, () => undefined));
}
