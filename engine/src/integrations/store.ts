// D1 access for connections. Everything is scoped by org id; the sealed Slack token never leaves this module's helpers.
import type { Connection, Provider } from "@probity/shared";
import type { IntEnv } from "./env";
import { nowIso } from "./env";

export const PROVIDERS: Provider[] = ["gmail", "outlook", "xero", "slack"];

export type ConnRow = { org_id: string; provider: Provider; status: "pending" | "connected" | "error"; account: string | null; detail: string | null; connected_account_id: string | null; trigger_id: string | null; meta: string | null; connected_at: string | null; updated_at: string };

export async function getConn(env: Pick<IntEnv, "DB">, orgId: string, provider: Provider): Promise<ConnRow | null> {
  return env.DB.prepare("SELECT * FROM connections WHERE org_id = ?1 AND provider = ?2").bind(orgId, provider).first<ConnRow>();
}
export async function listConns(env: Pick<IntEnv, "DB">, orgId: string): Promise<ConnRow[]> {
  return (await env.DB.prepare("SELECT * FROM connections WHERE org_id = ?1").bind(orgId).all<ConnRow>()).results;
}

export async function saveConn(env: Pick<IntEnv, "DB">, orgId: string, provider: Provider, p: Partial<Omit<ConnRow, "org_id" | "provider" | "updated_at">> & { status: ConnRow["status"] }): Promise<void> {
  const cur = await getConn(env, orgId, provider);
  const next = { account: null, detail: null, connected_account_id: null, trigger_id: null, meta: null, connected_at: null, ...(cur ?? {}), ...p };
  await env.DB.prepare(
    "INSERT INTO connections (org_id, provider, status, account, detail, connected_account_id, trigger_id, meta, connected_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(org_id, provider) DO UPDATE SET status=excluded.status, account=excluded.account, detail=excluded.detail, connected_account_id=excluded.connected_account_id, trigger_id=excluded.trigger_id, meta=excluded.meta, connected_at=excluded.connected_at, updated_at=excluded.updated_at",
  ).bind(orgId, provider, next.status, next.account, next.detail, next.connected_account_id, next.trigger_id, next.meta, next.connected_at, nowIso()).run();
}
export async function deleteConn(env: Pick<IntEnv, "DB">, orgId: string, provider: Provider): Promise<void> {
  await env.DB.prepare("DELETE FROM connections WHERE org_id = ?1 AND provider = ?2").bind(orgId, provider).run();
}

/** The contract shape for the settings screen: one entry per provider, never a token. */
export function toConnection(provider: Provider, row: ConnRow | null | undefined, now = Date.now()): Connection {
  if (!row) return { provider, status: "not_connected", account: null, connectedAt: null, detail: null };
  const stale = row.status === "pending" && now - Date.parse(row.updated_at) > 15 * 60_000;
  const status = stale ? "not_connected" : row.status;
  return { provider, status, account: row.account, connectedAt: row.connected_at, detail: stale ? null : row.detail };
}

export async function connectionList(env: Pick<IntEnv, "DB">, orgId: string): Promise<Connection[]> {
  const rows = await listConns(env, orgId);
  return PROVIDERS.map((p) => toConnection(p, rows.find((r) => r.provider === p)));
}
