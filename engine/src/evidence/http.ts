// Fetch with a timeout, a 24 h KV cache for registry responses and a politeness gate for the SEC.
import { LOOKUP_TIMEOUT_MS, type EvidenceEnv } from "./types";

export async function fetchWithTimeout(url: string, init: RequestInit = {}, ms = LOOKUP_TIMEOUT_MS): Promise<Response> {
  return fetch(url, { ...init, signal: AbortSignal.timeout(ms) });
}

/** GET/POST returning parsed JSON, or null on any network, status or parse failure. Never throws. */
export async function fetchJson(url: string, init: RequestInit = {}, ms = LOOKUP_TIMEOUT_MS): Promise<unknown | null> {
  try {
    const res = await fetchWithTimeout(url, init, ms);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function fetchText(url: string, init: RequestInit = {}, ms = LOOKUP_TIMEOUT_MS): Promise<string | null> {
  try {
    const res = await fetchWithTimeout(url, init, ms);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

type Stored<T> = { at: string; value: T };

/** Read-through KV cache. `produce` returns null for "source unavailable", which is never cached. */
export async function cachedLookup<T>(env: Pick<EvidenceEnv, "CACHE">, key: string, ttlSeconds: number, produce: () => Promise<T | null>, fresh = false): Promise<{ value: T; at: string; cached: boolean } | null> {
  try {
    if (fresh) throw new Error("fresh");
    const hit = await env.CACHE.get<Stored<T>>(key, "json");
    if (hit) return { value: hit.value, at: hit.at, cached: true };
  } catch {
    // a cache read failure only costs a live fetch
  }
  const value = await produce();
  if (value === null) return null;
  const at = new Date().toISOString();
  try {
    await env.CACHE.put(key, JSON.stringify({ at, value } satisfies Stored<T>), { expirationTtl: Math.max(60, ttlSeconds) });
  } catch {
    // KV write limits must not fail a lookup
  }
  return { value, at, cached: false };
}

let secGate: Promise<void> = Promise.resolve();
/** SEC fair access: at most 10 requests per second. Calls through this gate start at least 120 ms apart within one isolate. */
export function secThrottle(): Promise<void> {
  const turn = secGate.then(() => new Promise<void>((r) => setTimeout(r, 120)));
  secGate = turn;
  return turn;
}
