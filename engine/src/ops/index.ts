// Ops: spend guard, the Nebius NeMo Guardrails job's ingest routes, and the in-app rails. A mounts `opsRoutes` at /api.
export { guardLiveCheck, refundLiveCheck, getLimits, CAPS } from "./guard";
export { opsRoutes, makeOpsRoutes, defaultSessionId } from "./routes";
export { latestSweep, storeCallback, registerJob, type OpsEnv } from "./sweep";
export { railInput, railOutput, railsPass, parseRailAnswer } from "./rails";
export { sweepWork } from "./work";

/** Cron entry. The 5-minute pre-run re-check pass replaces this body in the schedule commit. */
export async function scheduled(_event: ScheduledController, _env: unknown, _ctx: ExecutionContext): Promise<void> {
  // nothing is due until company schedules exist
}
