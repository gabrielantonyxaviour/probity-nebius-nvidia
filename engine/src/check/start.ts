// Starting a live check: admission (spend stop, caps, plan), the run row, the Workflow. Shared by the routes and by intake.
import { DEMO_ORG_ID } from "@probity/shared";
import { guardLiveCheck, refundLiveCheck } from "../ops/guard";
import type { Env } from "../env";
import { newRun } from "./run";
import { consumeCheck } from "../billing/plans";
import { insertRun, setRequestState } from "../workflow/d1store";

export type Started = { ok: true; runId: string } | { ok: false; code: string };

/** Takes one live check from the caps (and, for a real company, from its plan). */
export async function admit(env: Env, sessionId: string, orgId: string): Promise<{ ok: true } | { ok: false; code: string }> {
  const g = await guardLiveCheck(env, sessionId, orgId);
  if (!g.ok) return g;
  if (orgId !== DEMO_ORG_ID && !(await consumeCheck(env, orgId))) return { ok: false, code: "plan_limit" };
  return { ok: true };
}

/** Hands one check back to a company's monthly allowance (the run never started). */
async function refundCheck(env: Env, orgId: string): Promise<void> {
  await env.DB.prepare("UPDATE check_usage SET n = MAX(0, n - 1) WHERE org_id = ?1 AND month = ?2").bind(orgId, new Date().toISOString().slice(0, 7)).run();
}

export async function giveBack(env: Env, sessionId: string, orgId: string): Promise<void> {
  await refundLiveCheck(env, sessionId, orgId);
  if (orgId !== DEMO_ORG_ID) await refundCheck(env, orgId);
}

/** Admits the check, creates the run and starts the Workflow. Gives the check back if it cannot start. */
export async function startRun(env: Env, sessionId: string, orgId: string, requestId: string, vendorName: string, admitted = false): Promise<Started> {
  if (!admitted) {
    const ok = await admit(env, sessionId, orgId);
    if (!ok.ok) return ok;
  }
  const runId = `run-${crypto.randomUUID().replace(/-/g, "").slice(0, 14)}`;
  try {
    await insertRun(env.DB, newRun({ id: runId, requestId, vendorName, live: true }), orgId);
    await setRequestState(env.DB, requestId, { status: "checking", latestRunId: runId });
    await env.CHECK.create({ id: runId, params: { runId, sessionId, orgId } });
  } catch {
    await giveBack(env, sessionId, orgId);
    await env.DB.prepare("UPDATE runs SET status = 'failed' WHERE id = ?1").bind(runId).run().catch(() => undefined);
    return { ok: false, code: "start_failed" };
  }
  return { ok: true, runId };
}
