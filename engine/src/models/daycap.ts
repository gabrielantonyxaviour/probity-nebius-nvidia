// The hard daily cap on Token Factory spend: $0.25 per UTC day across every model call the app makes (checks, crons,
// rails, mail classification, retries, fallbacks). A call reserves its worst-case cost atomically before it is sent,
// and settles to the actual cost (real token counts at list prices) when it returns; the kill switch stops every call.
import type { ModelId } from "@probity/shared";
import { PRICES } from "./prices";

export const DAILY_CAP_USD = 0.25;
export const LIMIT_MESSAGE = "Daily limit reached. Try again after 08:00 MYT.";
export const STOPPED_MESSAGE = "Model calls are switched off for now.";
const IMAGE_TOKENS = 2000; // a page image costs on the order of a thousand tokens; counted generously

type Db = { DB: D1Database };
export const hasDb = (env: unknown): env is Db => !!env && typeof (env as { DB?: unknown }).DB === "object" && (env as { DB?: unknown }).DB !== null;
export const utcDay = (now = Date.now()): string => new Date(now).toISOString().slice(0, 10);

type Content = string | Array<{ type: string; text?: string }> | null | undefined;
/** Worst case for one call: every prompt token at the uncached input rate plus the full output allowance. */
export function worstCaseUsd(model: ModelId, messages: Array<{ content: Content }>, maxTokens: number): number {
  let chars = 0, images = 0;
  for (const m of messages) {
    if (typeof m.content === "string") chars += m.content.length;
    else if (Array.isArray(m.content)) for (const p of m.content) p.type === "text" ? (chars += p.text?.length ?? 0) : images++;
  }
  const promptTokens = Math.ceil(chars / 3) + images * IMAGE_TOKENS;
  const p = PRICES[model];
  return (promptTokens * p.input + maxTokens * p.output) / 1_000_000;
}

export async function isStopped(env: Db): Promise<boolean> {
  const r = await env.DB.prepare("SELECT value FROM settings WHERE key = 'stopped'").first<{ value: string | null }>().catch(() => null);
  return r?.value === "1";
}

/** Reserves `usd` for today if the day stays within the cap; false means the call must not be made. */
export async function reserve(env: Db, usd: number, now = Date.now()): Promise<boolean> {
  const day = utcDay(now);
  const r = await env.DB.prepare(
    "INSERT INTO model_spend_day (day, usd, calls) VALUES (?1, ?2, 1) ON CONFLICT(day) DO UPDATE SET usd = usd + ?2, calls = calls + 1 WHERE usd + ?2 <= ?3",
  ).bind(day, usd, DAILY_CAP_USD).run();
  if ((r.meta.changes ?? 0) > 0 && usd <= DAILY_CAP_USD) return true;
  if ((r.meta.changes ?? 0) > 0) await settle(env, usd, 0, now); // a single call larger than the whole cap: undo
  await env.DB.prepare("INSERT INTO model_spend_day (day, usd, refused) VALUES (?1, 0, 1) ON CONFLICT(day) DO UPDATE SET refused = refused + 1").bind(day).run();
  return false;
}

/** Replaces a reservation with what the call actually cost (0 when it was not billed). */
export async function settle(env: Db, reserved: number, actual: number, now = Date.now()): Promise<void> {
  await env.DB.prepare("UPDATE model_spend_day SET usd = MAX(0, usd - ?2 + ?3) WHERE day = ?1").bind(utcDay(now), reserved, actual).run();
}

export async function today(env: Db, now = Date.now()): Promise<{ day: string; usd: number; calls: number; refused: number }> {
  const day = utcDay(now);
  const r = await env.DB.prepare("SELECT usd, calls, refused FROM model_spend_day WHERE day = ?1").bind(day).first<{ usd: number; calls: number; refused: number }>();
  return { day, usd: r?.usd ?? 0, calls: r?.calls ?? 0, refused: r?.refused ?? 0 };
}
