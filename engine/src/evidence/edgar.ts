// SEC EDGAR: name -> CIK (company_tickers.json, then the browse-edgar Atom fallback), then the submissions record.
import { z } from "zod";
import type { Evidence } from "@probity/shared";
import { cachedLookup, fetchJson, fetchText, secThrottle } from "./http";
import { REGISTRY_TTL_S, clip, fact, formatAddress, formatPhone, nameScore, tidyCase, unavailable, type EvidenceEnv, type ToolResult } from "./types";

const Address = z.object({ street1: z.string().nullish(), street2: z.string().nullish(), city: z.string().nullish(), stateOrCountry: z.string().nullish(), zipCode: z.string().nullish() }).nullish();
const Submission = z.object({
  cik: z.string(),
  name: z.string(),
  tickers: z.array(z.string()).default([]),
  phone: z.string().nullish(),
  website: z.string().nullish(),
  investorWebsite: z.string().nullish(),
  ein: z.string().nullish(),
  lei: z.string().nullish(),
  sicDescription: z.string().nullish(),
  stateOfIncorporation: z.string().nullish(),
  addresses: z.object({ mailing: Address, business: Address }).partial().default({}),
  formerNames: z.array(z.object({ name: z.string(), to: z.string().nullish() })).default([]),
});
type Submission = z.infer<typeof Submission>;
const Tickers = z.record(z.object({ cik_str: z.number(), ticker: z.string(), title: z.string() }));

const headers = (env: EvidenceEnv): Record<string, string> => ({ "User-Agent": env.SEC_USER_AGENT || "Probity vendor checks (set SEC_USER_AGENT)", Accept: "application/json" });
const pad = (cik: string | number): string => String(cik).replace(/\D/g, "").padStart(10, "0");

async function tickerCandidates(env: EvidenceEnv, name: string): Promise<string[]> {
  const res = await cachedLookup(env, "edgar:tickers:v1", REGISTRY_TTL_S, async () => {
    await secThrottle();
    const raw = await fetchJson("https://www.sec.gov/files/company_tickers.json", { headers: headers(env) }, 15_000);
    const parsed = Tickers.safeParse(raw);
    if (!parsed.success) return null;
    // keep only what matching needs: one KV value, ~10k short rows
    return Object.values(parsed.data).map((r) => [pad(r.cik_str), r.title] as [string, string]);
  });
  if (!res) return [];
  return res.value
    .map(([cik, title]) => ({ cik, score: nameScore(name, title), len: title.length }))
    .filter((c) => c.score >= 0.75)
    .sort((a, b) => b.score - a.score || a.len - b.len)
    .slice(0, 3)
    .map((c) => c.cik);
}

async function atomCandidates(env: EvidenceEnv, name: string): Promise<string[]> {
  await secThrottle();
  const xml = await fetchText(`https://www.sec.gov/cgi-bin/browse-edgar?company=${encodeURIComponent(name)}&type=&owner=exclude&count=10&action=getcompany&output=atom`, { headers: headers(env) });
  if (!xml) return [];
  return [...new Set([...xml.matchAll(/<cik>(\d+)<\/cik>/g)].map((m) => pad(m[1] ?? "")))].slice(0, 4);
}

type Fetched = { value: Submission; at: string; cached: boolean };
async function submission(env: EvidenceEnv, cik: string, fresh = false): Promise<Fetched | null> {
  return cachedLookup(env, `edgar:sub:v1:${cik}`, REGISTRY_TTL_S, async () => {
    await secThrottle();
    const raw = await fetchJson(`https://data.sec.gov/submissions/CIK${cik}.json`, { headers: headers(env) });
    const parsed = Submission.safeParse(raw);
    return parsed.success ? parsed.data : null;
  }, fresh);
}

function describe(s: Submission): Array<{ field: Evidence["field"]; label: string; value: string }> {
  const out: Array<{ field: Evidence["field"]; label: string; value: string }> = [];
  out.push({ field: "legal_name", label: "Registered name (SEC)", value: s.name });
  const ids = [`CIK ${s.cik}`, s.tickers.length ? `ticker ${s.tickers.join(", ")}` : null, s.ein && s.ein !== "000000000" ? `EIN ${s.ein}` : null].filter(Boolean).join("; ");
  out.push({ field: "identifier", label: "SEC identifiers", value: ids });
  if (s.phone) out.push({ field: "phone", label: "Registered business phone (SEC)", value: formatPhone(s.phone) });
  const addr = (a: z.infer<typeof Address>): string => formatAddress([tidyCase(a?.street1 ?? ""), a?.street2, tidyCase(a?.city ?? ""), `${a?.stateOrCountry ?? ""} ${a?.zipCode ?? ""}`.trim()]);
  const business = addr(s.addresses.business);
  const mailing = addr(s.addresses.mailing);
  if (business) out.push({ field: "address", label: "Business address (SEC)", value: business });
  if (mailing && mailing !== business) out.push({ field: "address", label: "Mailing address (SEC)", value: mailing });
  const site = s.website || s.investorWebsite;
  if (site) out.push({ field: "domain", label: "Website filed with the SEC", value: site });
  if (s.formerNames.length) out.push({ field: "other", label: "Former names (SEC)", value: s.formerNames.map((f) => f.name).join("; ") });
  return out;
}

/** `fresh` skips the 24 h cache (the pre-run re-check wants today's facts). */
export async function lookupEdgar(env: EvidenceEnv, q: { name?: string; cik?: string }, opts: { fresh?: boolean } = {}): Promise<ToolResult> {
  try {
    let candidates: string[] = [];
    if (q.cik && /\d/.test(q.cik)) candidates = [pad(q.cik)];
    else if (q.name) {
      candidates = await tickerCandidates(env, q.name);
      if (candidates.length === 0) candidates = await atomCandidates(env, q.name);
    } else return { evidence: [], summary: "SEC EDGAR lookup needs a company name or a CIK." };

    let found: Fetched | null = null;
    let bestScore = -1;
    for (const cik of candidates) {
      const s = await submission(env, cik, opts.fresh);
      if (!s) continue;
      const score = q.name ? Math.max(nameScore(q.name, s.value.name), ...s.value.formerNames.map((f) => nameScore(q.name ?? "", f.name))) : 1;
      if (score > bestScore) { found = s; bestScore = score; }
    }
    const best = found?.value ?? null;
    if (!best) {
      if (candidates.length === 0 && q.name) return { evidence: [], summary: `SEC EDGAR has no registrant matching "${q.name}" (private companies are not registrants).` };
      return unavailable("SEC EDGAR", "the submissions record could not be read");
    }
    if (q.name && bestScore < 0.6) return { evidence: [], summary: `SEC EDGAR has no registrant matching "${q.name}"; the closest was "${best.name}" (CIK ${best.cik}), which is a different name.` };

    const cached = found?.cached ?? false;
    const at = found?.at ?? new Date().toISOString();
    const url = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${best.cik}&owner=exclude`;
    const facts = describe(best);
    const evidence = facts.map((f) => fact("sec_edgar", { ...f, url }, at, cached));
    const summary = clip(`SEC EDGAR record for ${best.name} (CIK ${best.cik}${best.tickers[0] ? `, ${best.tickers[0]}` : ""}): ${facts.filter((f) => f.field !== "legal_name" && f.field !== "identifier").map((f) => `${f.label.replace(/ \(SEC\)$/, "")}: ${f.value}`).join("; ")}.`);
    return { evidence, summary };
  } catch {
    return unavailable("SEC EDGAR", "an unexpected error occurred");
  }
}

