// GLEIF Legal Entity Identifier registry: fuzzy name completion, then the LEI record (legal and headquarters address, registration).
import { z } from "zod";
import { cachedLookup, fetchJson } from "./http";
import { REGISTRY_TTL_S, clip, fact, formatAddress, nameScore, tidyCase, unavailable, type EvidenceEnv, type ToolResult } from "./types";

const Completions = z.object({ data: z.array(z.object({ attributes: z.object({ value: z.string() }), relationships: z.object({ "lei-records": z.object({ data: z.object({ id: z.string() }).nullish() }).optional() }).optional() })) });
const Addr = z.object({ addressLines: z.array(z.string().nullable()).default([]), city: z.string().nullish(), region: z.string().nullish(), country: z.string().nullish(), postalCode: z.string().nullish() }).nullish();
const Record = z.object({
  data: z.object({
    attributes: z.object({
      lei: z.string(),
      entity: z.object({ legalName: z.object({ name: z.string() }), legalAddress: Addr, headquartersAddress: Addr, registeredAs: z.string().nullish(), jurisdiction: z.string().nullish(), status: z.string().nullish() }),
      registration: z.object({ status: z.string().nullish(), lastUpdateDate: z.string().nullish() }).nullish(),
    }),
  }),
});
type Rec = z.infer<typeof Record>["data"]["attributes"];
type Stored = { rec: Rec } | { none: true };

const addr = (a: z.infer<typeof Addr>): string => (a ? formatAddress([...a.addressLines.map((l) => tidyCase(l ?? "")), tidyCase(a.city ?? ""), (a.region ?? "").replace(/^US-/, ""), a.postalCode]) : "");

async function find(name: string): Promise<Stored | null> {
  const raw = await fetchJson(`https://api.gleif.org/api/v1/fuzzycompletions?field=entity.legalName&q=${encodeURIComponent(name)}`, { headers: { Accept: "application/vnd.api+json" } });
  const parsed = Completions.safeParse(raw);
  if (!parsed.success) return null;
  const top = parsed.data.data
    .map((d) => ({ lei: d.relationships?.["lei-records"]?.data?.id, score: nameScore(name, d.attributes.value) }))
    .filter((c) => c.lei && c.score >= 0.75)
    .sort((a, b) => b.score - a.score)[0];
  if (!top?.lei) return { none: true };
  const recRaw = await fetchJson(`https://api.gleif.org/api/v1/lei-records/${top.lei}`, { headers: { Accept: "application/vnd.api+json" } });
  const rec = Record.safeParse(recRaw);
  return rec.success ? { rec: rec.data.data.attributes } : null;
}

export async function lookupGleif(env: EvidenceEnv, q: { name: string }, opts: { fresh?: boolean } = {}): Promise<ToolResult> {
  try {
    const key = `gleif:v1:${q.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}`;
    const res = await cachedLookup(env, key, REGISTRY_TTL_S, () => find(q.name), opts.fresh);
    if (!res) return unavailable("GLEIF", "the registry did not answer");
    if ("none" in res.value) return { evidence: [], summary: `GLEIF has no legal entity identifier matching "${q.name}".` };
    const { rec } = res.value;
    const url = `https://search.gleif.org/#/record/${rec.lei}`;
    const legal = addr(rec.entity.legalAddress);
    const hq = addr(rec.entity.headquartersAddress);
    const status = [rec.entity.status ? `entity ${rec.entity.status}` : null, rec.registration?.status ? `LEI ${rec.registration.status}` : null].filter(Boolean).join(", ");
    const inputs = [
      { field: "legal_name" as const, label: "Legal name (GLEIF)", value: rec.entity.legalName.name },
      { field: "identifier" as const, label: "Legal Entity Identifier (LEI)", value: `${rec.lei}${status ? ` (${status})` : ""}` },
      ...(rec.entity.registeredAs ? [{ field: "identifier" as const, label: `Registration number${rec.entity.jurisdiction ? ` (${rec.entity.jurisdiction})` : ""}`, value: rec.entity.registeredAs }] : []),
      ...(legal ? [{ field: "address" as const, label: "Legal address (GLEIF)", value: legal }] : []),
      ...(hq && hq !== legal ? [{ field: "address" as const, label: "Headquarters address (GLEIF)", value: hq }] : []),
    ];
    const evidence = inputs.map((f) => fact("gleif", { ...f, url }, res.at, res.cached));
    return { evidence, summary: clip(`GLEIF record for ${rec.entity.legalName.name} (LEI ${rec.lei}; ${status || "status unknown"}): legal address ${legal || "none"}${hq && hq !== legal ? `; headquarters ${hq}` : ""}${rec.entity.registeredAs ? `; registration no. ${rec.entity.registeredAs}` : ""}. GLEIF holds no phone numbers.`) };
  } catch {
    return unavailable("GLEIF", "an unexpected error occurred");
  }
}
