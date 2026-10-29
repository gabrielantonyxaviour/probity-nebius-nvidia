// Logging the result of the call-back. One function for the HTTP route and for the Slack buttons.
import { Run, type Outcome } from "@probity/shared";
import { DEMO_ORG_ID } from "@probity/shared";
import type { Env } from "../env";
import { applyOutcome } from "../policy/gate";

export type LogResult = { ok: true; run: Run; stored: boolean } | { ok: false; code: "not_found" | "not_finished" | "bad_run" | "forbidden" };

/**
 * Applies the outcome to a finished run. `orgId` is the caller's company: a run of another company is "not_found".
 * A recorded run (live = 0) is shared by every visitor, so its outcome is shown but never stored.
 */
export async function logOutcome(env: Env, orgId: string, runId: string, result: Outcome["result"], by: string, note: string | null = null): Promise<LogResult> {
  const row = await env.DB.prepare("SELECT json, live, org_id FROM runs WHERE id = ?1").bind(runId).first<{ json: string; live: number; org_id: string }>();
  if (!row || (row.org_id !== orgId && row.org_id !== DEMO_ORG_ID)) return { ok: false, code: "not_found" };
  const parsed = Run.safeParse(JSON.parse(row.json));
  if (!parsed.success) return { ok: false, code: "bad_run" };
  const run = parsed.data;
  if (run.status !== "done" || !run.decision) return { ok: false, code: "not_finished" };
  const outcome: Outcome = { result, by, at: new Date().toISOString(), note };
  const updated: Run = { ...run, decision: applyOutcome(run.decision, outcome) };
  if (row.live !== 1) return { ok: true, run: updated, stored: false };
  await env.DB.batch([
    env.DB.prepare("UPDATE runs SET json = ?2, updated_at = ?3 WHERE id = ?1").bind(runId, JSON.stringify(updated), outcome.at),
    env.DB.prepare("UPDATE requests SET outcome = ?2, status = ?3 WHERE id = ?1").bind(run.requestId, result, result === "no_answer" ? "checked" : "closed"),
  ]);
  return { ok: true, run: updated, stored: true };
}
