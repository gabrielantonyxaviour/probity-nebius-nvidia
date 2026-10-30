// Tavily web lookup: one basic Search for the official site, one basic Extract of its contact page. Plain fetch, no SDK.
// A fresh lookup is 2 credits. Results are cached 30 days (a hit costs 0). Probity's shared budget is 150 credits per month.
import { z } from "zod";
import type { Evidence } from "@probity/shared";
import { CAPS, tavilyGate, tavilyRecord, tavilyRefund } from "../ops/guard";
import { cachedLookup, fetchWithTimeout } from "./http";
import { clip, fact, normaliseName, nameTokens, type EvidenceEnv, type ToolResult } from "./types";

const TTL_S = 30 * 24 * 60 * 60;
const Search = z.object({ results: z.array(z.object({ url: z.string(), title: z.string().default(""), content: z.string().default("") })).default([]), usage: z.object({ credits: z.number() }).partial().nullish() });
const Extract = z.object({ results: z.array(z.object({ url: z.string(), raw_content: z.string().default("") })).default([]), usage: z.object({ credits: z.number() }).partial().nullish() });

const AGGREGATORS = ["linkedin.", "facebook.", "twitter.", "x.com", "instagram.", "youtube.", "yelp.", "zoominfo.", "dnb.com", "bloomberg.", "wikipedia.", "glassdoor.", "indeed.", "mapquest.", "yellowpages.", "crunchbase.", "opencorporates.", "manta.", "bbb.org", "sec.gov", "usaspending.gov", "sam.gov", "gleif.org", "reddit.", "pitchbook.", "rocketreach.", "cbinsights.", "buzzfile.", "chamberofcommerce.", "mapquest.", "google.", "bing.", "tiktok.", "dandb.com", "opengovus."];
const PHONE = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]?([2-9]\d{2})[\s.-]?(\d{4})\b/g;

const RESERVED_TLD = /\.(example|test|invalid|localhost|local|internal)$/i;
/** A domain hint on a reserved TLD (the demo's .example addresses) makes Tavily reject the whole search: drop it. */
export const usableHint = (hint?: string): string | undefined => (hint && !RESERVED_TLD.test(hint.trim()) ? hint.trim() : undefined);

export type TavilyStored = { domain: string | null; pageUrl: string | null; phones: string[]; snippets: string[]; flags: string[]; creditsOnFetch: number };
export type TavilyResult = ToolResult & { creditsUsed: number; snippets: string[] };

export const hostOf = (url: string): string | null => {
  try { return new URL(url).hostname.replace(/^www\./, "").toLowerCase(); } catch { return null; }
};
export const isAggregator = (host: string): boolean => AGGREGATORS.some((a) => host.includes(a));

export function extractPhones(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(PHONE)) out.add(`(${m[1]}) ${m[2]}-${m[3]}`);
  return [...out];
}

/** Picks the official domain from search results: the hint if it appears, else the non-aggregator host that shares the most words with the company name. */
export function pickDomain(company: string, results: Array<{ url: string }>, hint?: string): { host: string; url: string } | null {
  const tokens = nameTokens(company);
  const scored = results.flatMap((r, i) => {
    const host = hostOf(r.url);
    if (!host || isAggregator(host)) return [];
    const flat = host.replace(/[^a-z0-9]/g, "");
    const hit = tokens.filter((t) => flat.includes(t)).length;
    const hinted = hint && host.endsWith(hint.toLowerCase().replace(/^www\./, "")) ? 5 : 0;
    return [{ host, url: r.url, score: hit + hinted - i * 0.01 }];
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored[0];
  return top && top.score >= 1 ? { host: top.host, url: top.url } : null;
}

export function pickContactPage(host: string, results: Array<{ url: string }>): string | null {
  const own = results.map((r) => r.url).filter((u) => hostOf(u) === host);
  return own.find((u) => /contact|about|locations|reach/i.test(u)) ?? own[0] ?? null;
}

async function post<T>(env: EvidenceEnv, path: string, body: unknown, schema: z.ZodType<T, z.ZodTypeDef, unknown>): Promise<T | null> {
  try {
    const res = await fetchWithTimeout(`https://api.tavily.com/${path}`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${env.TAVILY_API_KEY}` }, body: JSON.stringify(body) }, 20_000);
    if (!res.ok) return null;
    const parsed = schema.safeParse(await res.json());
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

async function fetchFresh(env: EvidenceEnv, company: string, hint?: string): Promise<{ stored: TavilyStored; credits: number } | null> {
  const search = await post(env, "search", { query: `"${company}" official website contact phone`, search_depth: "basic", max_results: 5, include_answer: false, include_raw_content: false, include_usage: true, ...(hint ? { include_domains: [hint], include_domains_mode: "prefer" } : { country: "united states" }) }, Search);
  if (!search) return null;
  let credits = search.usage?.credits ?? 1;
  const pick = pickDomain(company, search.results, hint);
  const snippets = search.results.slice(0, 5).map((r) => `${r.title} (${hostOf(r.url) ?? r.url}): ${r.content}`.slice(0, 600));
  // News evidence needs a result that is about this company AND about fraud, and is not a careers or jobs page.
  const lead = nameTokens(company)[0];
  const flags = search.results.filter((r) => lead !== undefined && !/career|jobs?\b|recruit|hiring/i.test(r.url) && new RegExp(lead, "i").test(`${r.title} ${r.content}`) && /(scam|fraud|phish|impersonat|spoof)\w*.{0,80}\b(payment|bank|vendor|invoice|email|e-mail|remit)|\b(payment|bank|vendor|invoice|email|e-mail|remit)\w*.{0,80}(scam|fraud|phish|impersonat|spoof)/i.test(`${r.title} ${r.content}`)).map((r) => `${hostOf(r.url) ?? r.url}: ${r.content.slice(0, 220)}`).slice(0, 2);
  if (!pick) return { stored: { domain: null, pageUrl: null, phones: [], snippets, flags, creditsOnFetch: credits }, credits };
  const page = pickContactPage(pick.host, search.results) ?? `https://${pick.host}/contact`;
  const extract = await post(env, "extract", { urls: [page], extract_depth: "basic", format: "text", include_usage: true }, Extract);
  credits += extract ? (extract.usage?.credits ?? 1) : 0;
  const text = extract?.results[0]?.raw_content ?? "";
  const phones = extractPhones(`${text}\n${search.results.filter((r) => hostOf(r.url) === pick.host).map((r) => r.content).join("\n")}`).slice(0, 4);
  if (text) snippets.push(`Contact page text (${pick.host}): ${text.replace(/\s+/g, " ").slice(0, 900)}`);
  return { stored: { domain: pick.host, pageUrl: page, phones, snippets, flags, creditsOnFetch: credits }, credits };
}

function toResult(stored: TavilyStored, company: string, at: string, cached: boolean, creditsUsed: number): TavilyResult {
  const evidence: Evidence[] = [];
  if (stored.domain) evidence.push(fact("tavily", { field: "domain", label: "Official website found on the web", value: stored.domain, url: stored.pageUrl ?? `https://${stored.domain}` }, at, cached));
  for (const p of stored.phones) evidence.push(fact("tavily", { field: "phone", label: `Phone on ${stored.domain ?? "the company's"} website`, value: p, url: stored.pageUrl }, at, cached));
  for (const f of stored.flags) evidence.push(fact("tavily", { field: "news", label: "Web result mentioning fraud or impersonation", value: f, url: null }, at, cached));
  const summary = clip(stored.domain
    ? `Web lookup for ${company}: official site ${stored.domain}${stored.phones.length ? `; phones on its own site ${stored.phones.join(", ")}` : "; no phone number found on its contact page"}${stored.flags.length ? `; ${stored.flags.length} result(s) mention fraud or impersonation` : ""}.${cached ? " (cached)" : ""}`
    : `Web lookup for ${company}: no official website could be identified from the search results.`);
  return { evidence, summary, creditsUsed, snippets: stored.snippets };
}

export async function tavilyContact(env: EvidenceEnv, q: { company: string; domainHint?: string; sessionId: string }): Promise<TavilyResult> {
  const none = (summary: string): TavilyResult => ({ evidence: [], summary, creditsUsed: 0, snippets: [] });
  try {
    if (!env.TAVILY_API_KEY) return none("Web lookup is not configured; no web lookup was made.");
    const hint = usableHint(q.domainHint);
    const key = `tavily:v1:${normaliseName(q.company)}|${normaliseName(hint ?? "")}`;
    // A cache read costs nothing and needs no budget; only a miss passes the gate.
    const peek = await env.CACHE.get<{ at: string; value: TavilyStored }>(key, "json").catch(() => null);
    if (peek) return toResult(peek.value, q.company, peek.at, true, 0);

    const gate = await tavilyGate(env, q.sessionId);
    if (!gate.ok) return none(gate.why === "budget" ? "Web lookup budget used up; no web lookup was made." : `This session has used its ${CAPS.tavilyLookupsPerSession} new web lookups; no web lookup was made.`);
    let spent = 0;
    const res = await cachedLookup(env, key, TTL_S, async () => {
      const fresh = await fetchFresh(env, q.company, hint);
      if (fresh) spent = fresh.credits;
      return fresh?.stored ?? null;
    });
    if (spent > 0) await tavilyRecord(env, spent);
    if (!res) {
      await tavilyRefund(env, q.sessionId);
      return none("The web lookup service did not answer; no web facts were retrieved.");
    }
    return toResult(res.value, q.company, res.at, res.cached, res.cached ? 0 : spent);
  } catch {
    return none("The web lookup failed; no web facts were retrieved.");
  }
}
