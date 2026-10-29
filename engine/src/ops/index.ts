// Ops: spend guard, the Nebius sweep job, and the cron entry. A mounts `opsRoutes` at /api and re-exports `scheduled`.
import { isStopped } from "./guard";
import { startSweep, type OpsEnv } from "./sweep";

export { guardLiveCheck, refundLiveCheck, getLimits, CAPS } from "./guard";
export { opsRoutes, makeOpsRoutes, defaultSessionId } from "./routes";
export { startSweep, latestSweep, storeCallback, type OpsEnv, type SweepMode } from "./sweep";

/** Cron entry: weekdays 02:00 MYT = `0 18 * * 0-4` UTC (Sun-Thu 18:00). Skipped while the kill switch is on. */
export async function scheduled(_event: ScheduledController, env: OpsEnv, ctx: ExecutionContext): Promise<void> {
  if (await isStopped(env)) return;
  ctx.waitUntil(startSweep(env, "sweep").then(() => undefined, () => undefined));
}
