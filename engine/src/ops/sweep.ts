// The Nebius NeMo Guardrails job: an operator starts it from the CLI (scripts/start-sweep.sh); it fetches the open requests' untrusted text
// through the signed work route and posts its SweepReport to the signed callback, stored here.
import { SweepReport } from "@probity/shared";
import { z } from "zod";
import { recordJobSpend } from "./spend";

export type OpsEnv = { DB: D1Database; CACHE: KVNamespace; FILES: R2Bucket; JOB_CALLBACK_SECRET: string; NEBIUS_API_KEY: string; APP_URL?: string };
export type SweepMode = "sweep" | "eval";
export const DEFAULT_APP_URL = "https://probity.pages.dev";

/** What the job posts back. Extra fields (flagged ids, per-case eval detail) are kept in the stored JSON, not in the contract. */
export const CallbackBody = z.object({
  sweepId: z.string().default(""),
  mode: z.enum(["sweep", "eval"]).default("sweep"),
  state: z.enum(["completed", "failed"]),
  startedAt: z.string(),
  finishedAt: z.string(),
  requestsSwept: z.number().int().min(0),
  recheckedRequestIds: z.array(z.string()).default([]),
  flaggedRequestIds: z.array(z.string()).default([]),
  sweptRequestIds: z.array(z.string()).default([]),
  nemo: z.object({ spansChecked: z.number().int(), flagged: z.number().int(), outputChecks: z.number().int(), outputBlocked: z.number().int() }),
  eval: z.object({ cases: z.number().int(), injected: z.number().int(), caught: z.number().int(), clean: z.number().int(), falseAlarms: z.number().int() }).nullable().default(null),
  evalDetail: z.array(z.object({ id: z.string(), injection: z.boolean(), flagged: z.boolean() })).optional(),
  costUsd: z.number().min(0),
  /** Token Factory cost of the rail calls, estimated by the job from the prompt and reply sizes. */
  tokenCostUsd: z.number().min(0).default(0),
  error: z.string().optional(),
});
export type CallbackBody = z.infer<typeof CallbackBody>;

type Row = { job_id: string; json: string; created_at: string };
const now = (): string => new Date().toISOString();

export const RegisterInput = z.object({ sweepId: z.string(), jobId: z.string(), mode: z.enum(["sweep", "eval"]) });
/** Records a job an operator started from the CLI: the real Nebius job id, "starting", findable by its sweep id. */
export async function registerJob(env: Pick<OpsEnv, "DB">, r: z.infer<typeof RegisterInput>): Promise<void> {
  const startedAt = now();
  const json = JSON.stringify({ jobId: r.jobId, sweepId: r.sweepId, mode: r.mode, state: "starting", startedAt, finishedAt: null, requestsSwept: 0, recheckedRequestIds: [], nemo: { spansChecked: 0, flagged: 0, outputChecks: 0, outputBlocked: 0 }, eval: null, costUsd: 0 });
  await env.DB.prepare("INSERT INTO sweep_reports (job_id, json, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(job_id) DO NOTHING").bind(r.jobId, json, startedAt).run();
}

/** Stores the job's report and stamps `swept_at` on the requests it looked at. */
export const NEBIUS_JOB_USD_PER_HOUR = 0.068; // cpu-d3 2vcpu-8gb $0.066/h + 20 GiB network SSD $0.002/h

/** Nebius compute for a job: from when it was registered (or started) until its report, at the cpu-d3 hourly rate. */
export function jobComputeUsd(fromIso: string, toIso: string): number {
  const secs = Math.max(0, (Date.parse(toIso) - Date.parse(fromIso)) / 1000);
  return Math.round((secs / 3600) * NEBIUS_JOB_USD_PER_HOUR * 1e6) / 1e6;
}

/** `opts.nebiusJob: false` for the in-app re-check, which is not a Nebius job (its Token Factory cost is recorded by the caller). */
export async function storeCallback(env: Pick<OpsEnv, "DB">, body: CallbackBody, opts: { nebiusJob?: boolean } = {}): Promise<SweepReport> {
  const row = body.sweepId ? await env.DB.prepare("SELECT job_id, json, created_at FROM sweep_reports WHERE job_id = ?1 OR json_extract(json, '$.sweepId') = ?1 LIMIT 1").bind(body.sweepId).first<Row>() : null;
  const jobId = row?.job_id ?? (body.sweepId || `job-${crypto.randomUUID().slice(0, 8)}`);
  const report = SweepReport.parse({ jobId, state: body.state, startedAt: body.startedAt, finishedAt: body.finishedAt, requestsSwept: body.requestsSwept, recheckedRequestIds: body.recheckedRequestIds, nemo: body.nemo, eval: body.eval, costUsd: body.costUsd });
  const stored = JSON.stringify({ ...report, sweepId: body.sweepId, mode: body.mode, flaggedRequestIds: body.flaggedRequestIds, evalDetail: body.evalDetail, error: body.error });
  const priorState = row ? (JSON.parse(row.json) as { state?: string }).state : undefined;
  await env.DB.prepare("INSERT INTO sweep_reports (job_id, json, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(job_id) DO UPDATE SET json = excluded.json").bind(jobId, stored, row?.created_at ?? body.startedAt).run();
  // Count the job against the Nebius budget once: the first terminal report only, so a retried callback cannot double-bill it.
  if (opts.nebiusJob !== false && priorState !== "completed" && priorState !== "failed") {
    const usd = jobComputeUsd(row?.created_at ?? body.startedAt, body.finishedAt) + body.tokenCostUsd;
    await recordJobSpend(env, usd, `nebius job ${jobId} (${body.mode}): compute ${jobComputeUsd(row?.created_at ?? body.startedAt, body.finishedAt).toFixed(4)} + rails ${body.tokenCostUsd.toFixed(4)}`).catch(() => undefined);
  }
  for (const id of body.sweptRequestIds) await env.DB.prepare("UPDATE requests SET swept_at = ?1 WHERE id = ?2").bind(body.finishedAt, id).run();
  return report;
}

/** The latest sweep. A report with no eval numbers borrows the newest earlier eval numbers. */
export async function latestSweep(env: Pick<OpsEnv, "DB">): Promise<SweepReport | null> {
  const row = await env.DB.prepare("SELECT job_id, json, created_at FROM sweep_reports ORDER BY created_at DESC LIMIT 1").first<Row>();
  if (!row) return null;
  let report = SweepReport.parse(JSON.parse(row.json));
  if (report.eval === null) {
    const earlier = await env.DB.prepare("SELECT json FROM sweep_reports WHERE json_extract(json, '$.eval') IS NOT NULL ORDER BY created_at DESC LIMIT 1").first<{ json: string }>();
    if (earlier) report = { ...report, eval: SweepReport.parse(JSON.parse(earlier.json)).eval };
  }
  return report;
}
