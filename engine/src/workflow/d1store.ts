// Run persistence in D1 (`runs.json` holds the whole Run) and the request-row bookkeeping around it.
import type { Run } from "@probity/shared";
import type { RunStore } from "../check/types";

export class D1RunStore implements RunStore {
  constructor(private readonly db: D1Database) {}

  async get(runId: string): Promise<Run> {
    const row = await this.db.prepare("SELECT json FROM runs WHERE id = ?1").bind(runId).first<{ json: string }>();
    if (!row) throw new Error(`run ${runId} not found`);
    return JSON.parse(row.json) as Run;
  }

  async update(runId: string, fn: (run: Run) => void): Promise<Run> {
    const run = await this.get(runId);
    fn(run);
    await this.db
      .prepare("UPDATE runs SET status = ?2, json = ?3, updated_at = ?4 WHERE id = ?1")
      .bind(runId, run.status, JSON.stringify(run), new Date().toISOString())
      .run();
    return run;
  }
}

export async function insertRun(db: D1Database, run: Run): Promise<void> {
  const now = new Date().toISOString();
  await db
    .prepare("INSERT INTO runs (id, request_id, status, live, json, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)")
    .bind(run.id, run.requestId, run.status, run.live ? 1 : 0, JSON.stringify(run), now)
    .run();
}

export async function setRequestState(db: D1Database, requestId: string, patch: { status: string; latestRunId?: string }): Promise<void> {
  if (patch.latestRunId) await db.prepare("UPDATE requests SET status = ?2, latest_run_id = ?3 WHERE id = ?1").bind(requestId, patch.status, patch.latestRunId).run();
  else await db.prepare("UPDATE requests SET status = ?2 WHERE id = ?1").bind(requestId, patch.status).run();
}
