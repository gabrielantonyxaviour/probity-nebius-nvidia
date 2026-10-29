// Spend guard. Live checks per day (all sessions) and per session, the kill switch, and the shared Tavily credit budget.
// All counters live in D1 `usage`; a consume is one conditional UPSERT, so two requests can never both take the last slot.
import type { Limits } from "@probity/shared";

export const CAPS = { liveChecksPerDay: 10, liveChecksPerSession: 3, tavilyCreditsPerMonth: 150, tavilyLookupsPerSession: 3 } as const;
/** A fresh lookup is one basic Search plus one basic Extract = 2 credits at the documented price. */
export const TAVILY_LOOKUP_CREDITS = 2;

export type GuardEnv = { DB: D1Database };
export type GuardResult = { ok: true } | { ok: false; code: "cap_reached" | "session_cap" | "stopped" };

const today = (): string => new Date().toISOString().slice(0, 10);
const month = (): string => new Date().toISOString().slice(0, 7);
const SESSION = "session"; // session counters do not reset at midnight: a judge session has 3 checks, full stop

async function consume(env: GuardEnv, day: string, sessionId: string, kind: string, cap: number): Promise<boolean> {
  const r = await env.DB.prepare("INSERT INTO usage (day, session_id, kind, n) VALUES (?1, ?2, ?3, 1) ON CONFLICT(day, session_id, kind) DO UPDATE SET n = n + 1 WHERE n < ?4").bind(day, sessionId, kind, cap).run();
  return (r.meta.changes ?? 0) > 0;
}
async function release(env: GuardEnv, day: string, sessionId: string, kind: string, by = 1): Promise<void> {
  await env.DB.prepare("UPDATE usage SET n = MAX(0, n - ?4) WHERE day = ?1 AND session_id = ?2 AND kind = ?3").bind(day, sessionId, kind, by).run();
}
async function used(env: GuardEnv, day: string, sessionId: string, kind: string): Promise<number> {
  const r = await env.DB.prepare("SELECT n FROM usage WHERE day = ?1 AND session_id = ?2 AND kind = ?3").bind(day, sessionId, kind).first<{ n: number }>();
  return r?.n ?? 0;
}
export async function isStopped(env: GuardEnv): Promise<boolean> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'stopped'").first<{ value: string | null }>();
  return r?.value === "1";
}

/** Takes one live check from the day and the session. On ok the slot is consumed. */
export async function guardLiveCheck(env: GuardEnv, sessionId: string): Promise<GuardResult> {
  if (await isStopped(env)) return { ok: false, code: "stopped" };
  if (!(await consume(env, today(), "*", "live_check", CAPS.liveChecksPerDay))) return { ok: false, code: "cap_reached" };
  if (!(await consume(env, SESSION, sessionId, "live_check", CAPS.liveChecksPerSession))) {
    await release(env, today(), "*", "live_check");
    return { ok: false, code: "session_cap" };
  }
  return { ok: true };
}

/** Hands a live check back when the run never started (for example the Workflow could not be created). */
export async function refundLiveCheck(env: GuardEnv, sessionId: string): Promise<void> {
  await release(env, today(), "*", "live_check");
  await release(env, SESSION, sessionId, "live_check");
}

export async function getLimits(env: GuardEnv, sessionId: string): Promise<Limits> {
  const [day, session, credits, stopped] = await Promise.all([used(env, today(), "*", "live_check"), used(env, SESSION, sessionId, "live_check"), used(env, month(), "*", "tavily_credit"), isStopped(env)]);
  return { liveChecksLeftToday: Math.max(0, CAPS.liveChecksPerDay - day), liveChecksPerDay: CAPS.liveChecksPerDay, sessionChecksLeft: Math.max(0, CAPS.liveChecksPerSession - session), tavilyCreditsUsed: credits, tavilyBudget: CAPS.tavilyCreditsPerMonth, stopped };
}

export type TavilyGate = { ok: true } | { ok: false; why: "budget" | "session" };

/** Before a fresh (uncached) Tavily lookup: monthly credit budget first, then the session's 3 new lookups. Consumes the session slot on ok. */
export async function tavilyGate(env: GuardEnv, sessionId: string): Promise<TavilyGate> {
  if ((await used(env, month(), "*", "tavily_credit")) + TAVILY_LOOKUP_CREDITS > CAPS.tavilyCreditsPerMonth) return { ok: false, why: "budget" };
  if (!(await consume(env, SESSION, sessionId, "tavily_lookup", CAPS.tavilyLookupsPerSession))) return { ok: false, why: "session" };
  return { ok: true };
}
export async function tavilyRefund(env: GuardEnv, sessionId: string): Promise<void> {
  await release(env, SESSION, sessionId, "tavily_lookup");
}
/** Adds the credits a call actually cost to the shared monthly total. */
export async function tavilyRecord(env: GuardEnv, credits: number): Promise<void> {
  if (credits <= 0) return;
  await env.DB.prepare("INSERT INTO usage (day, session_id, kind, n) VALUES (?1, '*', 'tavily_credit', ?2) ON CONFLICT(day, session_id, kind) DO UPDATE SET n = n + ?2").bind(month(), credits).run();
}
