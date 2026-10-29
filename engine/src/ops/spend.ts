// What Probity has spent on Nebius, all time. Gabriel's rule: stop at $7 (the ceiling is $10, the target $5).
import type { ModelCall } from "@probity/shared";

export const BUDGET_STOP_USD = 7;

export type SpendEnv = { DB: D1Database };
export type SpendRow = { kind: "token_factory" | "nebius_job"; usd: number; orgId?: string | null; runId?: string | null; model?: string | null; note?: string | null };

export async function totalSpendUsd(env: SpendEnv): Promise<number> {
  try {
    const r = await env.DB.prepare("SELECT COALESCE(SUM(usd), 0) AS usd FROM spend").first<{ usd: number }>();
    return r?.usd ?? 0;
  } catch (e) {
    if (e instanceof Error && /no such table/i.test(e.message)) return 0; // migration 0011 not applied yet (deploy order)
    throw e;
  }
}

async function hasSpendTable(env: SpendEnv): Promise<boolean> {
  const r = await env.DB.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'spend'").first<{ name: string }>();
  return !!r;
}

export async function budgetReached(env: SpendEnv): Promise<boolean> {
  return (await totalSpendUsd(env)) >= BUDGET_STOP_USD;
}

export async function recordSpend(env: SpendEnv, rows: SpendRow[]): Promise<void> {
  const real = rows.filter((r) => r.usd > 0);
  if (real.length === 0) return;
  if (!(await hasSpendTable(env))) return;
  const at = new Date().toISOString();
  await env.DB.batch(
    real.map((r) =>
      env.DB.prepare("INSERT INTO spend (at, kind, usd, org_id, run_id, model, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(at, r.kind, r.usd, r.orgId ?? null, r.runId ?? null, r.model ?? null, r.note ?? null),
    ),
  );
}

/** One row per Token Factory call of a run. */
export const recordCalls = (env: SpendEnv, orgId: string, runId: string, calls: ModelCall[]): Promise<void> =>
  recordSpend(env, calls.map((c) => ({ kind: "token_factory" as const, usd: c.costUsd, orgId, runId, model: c.model, note: c.stepKey })));

/** A Nebius job's compute estimate (called by the sweep job module when a job ends). */
export const recordJobSpend = (env: SpendEnv, usd: number, note: string): Promise<void> => recordSpend(env, [{ kind: "nebius_job", usd, note }]);
