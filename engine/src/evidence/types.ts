// Shared types and small helpers for the evidence modules. Workers runtime only: fetch and WebCrypto, no Node APIs.
import type { Evidence, Source } from "@probity/shared";

/** The bindings and vars the evidence modules read. The engine's full Env satisfies this structurally. */
export interface EvidenceEnv {
  DB: D1Database;
  CACHE: KVNamespace;
  FILES: R2Bucket;
  SEC_USER_AGENT?: string;
  TAVILY_API_KEY?: string;
}

/** What one lookup returns to the Workflow: facts with provenance plus a compact text for the model. */
export type ToolResult = { evidence: Evidence[]; summary: string };

export const SUMMARY_MAX = 1500;
export const LOOKUP_TIMEOUT_MS = 10_000;
export const REGISTRY_TTL_S = 24 * 60 * 60;

export function clip(text: string, max = SUMMARY_MAX): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

const SUFFIXES = new Set(["inc", "incorporated", "corp", "corporation", "co", "company", "llc", "llp", "pllc", "ltd", "limited", "lp", "plc", "holding", "holdings", "group", "the", "of", "and"]);

/** Lower-case words with punctuation removed; used for cache keys. */
export function normaliseName(name: string): string {
  return name.toLowerCase().replace(/&/g, " and ").replace(/[^a-z0-9]+/g, " ").trim();
}

/** The distinctive words of a company name (legal suffixes dropped), for matching names across registries. */
export function nameTokens(name: string): string[] {
  return normaliseName(name).split(" ").filter((t) => t && !SUFFIXES.has(t));
}

/** 0..1: how well `candidate` matches `wanted`. 1 = same distinctive words; the wanted words must all appear for a high score. */
export function nameScore(wanted: string, candidate: string): number {
  const w = nameTokens(wanted);
  const c = new Set(nameTokens(candidate));
  if (w.length === 0 || c.size === 0) return 0;
  const hit = w.filter((t) => c.has(t)).length;
  const recall = hit / w.length;
  const precision = hit / c.size;
  return recall === 1 && precision === 1 ? 1 : recall * 0.7 + precision * 0.3 - (recall < 1 ? 0.1 : 0);
}

export function hash6(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0").slice(0, 6);
}

export type FactInput = { field: Evidence["field"]; label: string; value: string; url?: string | null };

/** Builds Evidence with a stable id (ev-<source>-<hash>): the same fact looked up twice has the same id. */
export function fact(source: Source, input: FactInput, retrievedAt: string, cached: boolean): Evidence {
  return { id: `ev-${source}-${hash6(`${input.field}|${input.label}|${input.value}`)}`, source, field: input.field, label: input.label, value: input.value, url: input.url ?? null, retrievedAt, cached };
}

export function formatAddress(parts: Array<string | null | undefined>): string {
  return parts.map((p) => (p ?? "").trim()).filter(Boolean).join(", ");
}

/** Title-case an ALL CAPS registry string ("MCLEAN" -> "McLean"-ish "Mclean"); leaves mixed case alone. */
export function tidyCase(text: string): string {
  if (text !== text.toUpperCase()) return text;
  return text.toLowerCase().replace(/\b([a-z])/g, (m) => m.toUpperCase()).replace(/\bMc([a-z])/g, (_m, c: string) => `Mc${c.toUpperCase()}`).replace(/\b(Llc|Llp|Pllc|Lp|Usa|Us|Po)\b/g, (m) => m.toUpperCase());
}

export function unavailable(source: string, why: string): ToolResult {
  return { evidence: [], summary: `${source} was unavailable (${why}); no facts were retrieved from it.` };
}

/** "3217279100", "321-727-9100" and "+1 321 727 9100" -> "(321) 727-9100"; anything else is returned trimmed. */
export function formatPhone(raw: string): string {
  const d = raw.replace(/\D/g, "");
  const n = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return n.length === 10 ? `(${n.slice(0, 3)}) ${n.slice(3, 6)}-${n.slice(6)}` : raw.trim();
}
