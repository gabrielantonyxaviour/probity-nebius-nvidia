// The overnight pre-run sweep: start a Nebius job, hand it the open requests' untrusted text, store its SweepReport.
import { SweepReport } from "@probity/shared";
import { z } from "zod";
import { JOB_FILES } from "./job-files.generated";
import { isStopped } from "./guard";
import { createJob, getJob, type JobEnvVar, type NebiusEnv } from "./nebius";

export type OpsEnv = NebiusEnv & { DB: D1Database; FILES: R2Bucket; JOB_CALLBACK_SECRET: string; NEBIUS_API_KEY: string; APP_URL?: string; NEBIUS_KEY_SECRET_ID?: string };
export type SweepMode = "sweep" | "eval";
export const DEFAULT_APP_URL = "https://probity.pages.dev";
const REUSE_WINDOW_MS = 2 * 60 * 60 * 1000;

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
  error: z.string().optional(),
});
export type CallbackBody = z.infer<typeof CallbackBody>;

type Row = { job_id: string; json: string; created_at: string };
const now = (): string => new Date().toISOString();

function jobEnv(env: OpsEnv, mode: SweepMode, sweepId: string): JobEnvVar[] {
  const key: JobEnvVar = env.NEBIUS_KEY_SECRET_ID ? { name: "NEBIUS_API_KEY", secretId: env.NEBIUS_KEY_SECRET_ID } : { name: "NEBIUS_API_KEY", value: env.NEBIUS_API_KEY };
  return [{ name: "MODE", value: mode }, { name: "SWEEP_ID", value: sweepId }, { name: "APP_URL", value: env.APP_URL || DEFAULT_APP_URL }, { name: "JOB_CALLBACK_SECRET", value: env.JOB_CALLBACK_SECRET }, key];
}

/** Starts a sweep job (or returns the one already running). Safe to call from a Workflow step or the cron. */
export async function startSweep(env: OpsEnv, mode: SweepMode = "sweep"): Promise<{ jobId: string; sweepId: string; reused: boolean }> {
  const recent = await env.DB.prepare("SELECT job_id, json, created_at FROM sweep_reports ORDER BY created_at DESC LIMIT 1").first<Row>();
  if (recent && Date.now() - Date.parse(recent.created_at) < REUSE_WINDOW_MS) {
    const j = JSON.parse(recent.json) as { state?: string; mode?: string; sweepId?: string };
    if ((j.state === "starting" || j.state === "running") && (j.mode ?? "sweep") === mode) return { jobId: recent.job_id, sweepId: j.sweepId ?? recent.job_id, reused: true };
  }
  const sweepId = `sweep-${crypto.randomUUID().slice(0, 8)}`;
  const startedAt = now();
  const pending = { jobId: sweepId, sweepId, mode, state: "starting", startedAt, finishedAt: null, requestsSwept: 0, recheckedRequestIds: [], nemo: { spansChecked: 0, flagged: 0, outputChecks: 0, outputBlocked: 0 }, eval: null, costUsd: 0 };
  await env.DB.prepare("INSERT INTO sweep_reports (job_id, json, created_at) VALUES (?1, ?2, ?3)").bind(sweepId, JSON.stringify(pending), startedAt).run();
  try {
    const name = `probity-${mode}-${startedAt.slice(0, 16).replace(/[^0-9]/g, "")}`;
    const files = Object.entries(JOB_FILES).filter(([p]) => mode === "eval" || p !== "/opt/probity/testset.json").map(([containerPath, content]) => ({ containerPath, content }));
    const { jobId } = await createJob(env, { name, files, env: jobEnv(env, mode, sweepId), command: "bash", args: "/opt/probity/run.sh" });
    await env.DB.prepare("UPDATE sweep_reports SET job_id = ?1, json = ?2 WHERE job_id = ?3").bind(jobId, JSON.stringify({ ...pending, jobId }), sweepId).run();
    return { jobId, sweepId, reused: false };
  } catch (e) {
    await env.DB.prepare("UPDATE sweep_reports SET json = ?1 WHERE job_id = ?2").bind(JSON.stringify({ ...pending, state: "failed", finishedAt: now() }), sweepId).run();
    throw e;
  }
}

/** Stores the job's report and stamps `swept_at` on the requests it looked at. */
export async function storeCallback(env: Pick<OpsEnv, "DB">, body: CallbackBody): Promise<SweepReport> {
  const row = body.sweepId ? await env.DB.prepare("SELECT job_id, json, created_at FROM sweep_reports WHERE job_id = ?1 OR json_extract(json, '$.sweepId') = ?1 LIMIT 1").bind(body.sweepId).first<Row>() : null;
  const jobId = row?.job_id ?? (body.sweepId || `job-${crypto.randomUUID().slice(0, 8)}`);
  const report = SweepReport.parse({ jobId, state: body.state, startedAt: body.startedAt, finishedAt: body.finishedAt, requestsSwept: body.requestsSwept, recheckedRequestIds: body.recheckedRequestIds, nemo: body.nemo, eval: body.eval, costUsd: body.costUsd });
  const stored = JSON.stringify({ ...report, sweepId: body.sweepId, mode: body.mode, flaggedRequestIds: body.flaggedRequestIds, evalDetail: body.evalDetail, error: body.error });
  await env.DB.prepare("INSERT INTO sweep_reports (job_id, json, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(job_id) DO UPDATE SET json = excluded.json").bind(jobId, stored, row?.created_at ?? body.startedAt).run();
  for (const id of body.sweptRequestIds) await env.DB.prepare("UPDATE requests SET swept_at = ?1 WHERE id = ?2").bind(body.finishedAt, id).run();
  return report;
}

const TERMINAL_BAD = new Set(["FAILED", "CANCELLED", "ERROR"]);

/** The latest sweep. A report with no eval numbers borrows the newest earlier eval; a stuck "running" report is reconciled with Nebius. */
export async function latestSweep(env: OpsEnv, fetcher: typeof fetch = fetch): Promise<SweepReport | null> {
  const row = await env.DB.prepare("SELECT job_id, json, created_at FROM sweep_reports ORDER BY created_at DESC LIMIT 1").first<Row>();
  if (!row) return null;
  let report = SweepReport.parse(JSON.parse(row.json));
  if (report.state === "starting" || report.state === "running") {
    const debounce = `sweep:poll:${row.job_id}`;
    if (!(await env.CACHE.get(debounce)) && env.NEBIUS_SA_CREDENTIALS && !row.job_id.startsWith("sweep-")) {
      await env.CACHE.put(debounce, "1", { expirationTtl: 60 });
      try {
        const s = await getJob(env, row.job_id, fetcher);
        const next = s.state === "RUNNING" ? "running" : TERMINAL_BAD.has(s.state) ? "failed" : report.state;
        if (next !== report.state) {
          report = { ...report, state: next, finishedAt: next === "failed" ? (s.finishedAt ?? now()) : null };
          await env.DB.prepare("UPDATE sweep_reports SET json = ?1 WHERE job_id = ?2").bind(JSON.stringify({ ...JSON.parse(row.json), state: next, finishedAt: report.finishedAt }), row.job_id).run();
        }
      } catch {
        // Nebius unreachable: keep what we have
      }
    }
  }
  if (report.eval === null) {
    const earlier = await env.DB.prepare("SELECT json FROM sweep_reports WHERE json_extract(json, '$.eval') IS NOT NULL ORDER BY created_at DESC LIMIT 1").first<{ json: string }>();
    if (earlier) report = { ...report, eval: SweepReport.parse(JSON.parse(earlier.json)).eval };
  }
  return report;
}

export async function sweepSkipped(env: Pick<OpsEnv, "DB">): Promise<boolean> {
  return isStopped(env);
}
