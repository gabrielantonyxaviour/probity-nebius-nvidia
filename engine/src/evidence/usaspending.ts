// USAspending.gov recipient registry: search by name, then the recipient profile (UEI, legal name, address, parent).
import { z } from "zod";
import { cachedLookup, fetchJson } from "./http";
import { REGISTRY_TTL_S, clip, fact, formatAddress, nameScore, tidyCase, unavailable, type EvidenceEnv, type ToolResult } from "./types";

const Search = z.object({ results: z.array(z.object({ id: z.string(), name: z.string(), uei: z.string().nullish(), recipient_level: z.string().nullish(), amount: z.number().nullish() })) });
const Profile = z.object({
  name: z.string(),
  uei: z.string().nullish(),
  duns: z.string().nullish(),
  alternate_names: z.array(z.string()).nullish(),
  parent_name: z.string().nullish(),
  parent_uei: z.string().nullish(),
  location: z.object({ address_line1: z.string().nullish(), address_line2: z.string().nullish(), city_name: z.string().nullish(), city: z.string().nullish(), state_code: z.string().nullish(), state: z.string().nullish(), zip: z.string().nullish(), zip5: z.string().nullish() }).partial().nullish(),
});
type Stored = { id: string; profile: z.infer<typeof Profile> } | { none: true };

async function find(name: string, uei?: string): Promise<Stored | null> {
  const raw = await fetchJson("https://api.usaspending.gov/api/v2/recipient/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify({ keyword: name, limit: 8, page: 1, sort: "amount", order: "desc" }),
  });
  const parsed = Search.safeParse(raw);
  if (!parsed.success) return null;
  const ranked = parsed.data.results
    .map((r) => ({ r, score: nameScore(name, r.name) + (uei && r.uei === uei ? 1 : 0) + (r.recipient_level === "P" ? 0.02 : 0) + (r.recipient_level === "C" ? 0.01 : 0) }))
    .filter((c) => c.score >= 0.75)
    .sort((a, b) => b.score - a.score || (b.r.amount ?? 0) - (a.r.amount ?? 0));
  const top = ranked[0];
  if (!top) return { none: true };
  const profileRaw = await fetchJson(`https://api.usaspending.gov/api/v2/recipient/${encodeURIComponent(top.r.id)}/`, { headers: { Accept: "application/json" } });
  const profile = Profile.safeParse(profileRaw);
  return profile.success ? { id: top.r.id, profile: profile.data } : null;
}

/** `uei` (optional, from the vendor master) picks the matching record when several recipients share a name. */
export async function lookupUsaspending(env: EvidenceEnv, q: { name: string; uei?: string }): Promise<ToolResult> {
  try {
    const key = `usaspending:v1:${q.name.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()}${q.uei ? `:${q.uei}` : ""}`;
    const res = await cachedLookup(env, key, REGISTRY_TTL_S, () => find(q.name, q.uei));
    if (!res) return unavailable("USAspending", "the registry did not answer");
    if ("none" in res.value) return { evidence: [], summary: `USAspending has no federal award recipient matching "${q.name}".` };
    const { id, profile: p } = res.value;
    const url = `https://www.usaspending.gov/recipient/${id}/latest`;
    const loc = p.location ?? {};
    const address = formatAddress([tidyCase(loc.address_line1 ?? ""), loc.address_line2, tidyCase(loc.city_name ?? loc.city ?? ""), `${loc.state_code ?? loc.state ?? ""} ${loc.zip5 ?? loc.zip ?? ""}`.trim()]);
    const inputs = [
      { field: "legal_name" as const, label: "Recipient name (USAspending)", value: p.name },
      ...(p.uei ? [{ field: "identifier" as const, label: "Unique Entity ID (UEI)", value: p.uei }] : []),
      ...(address ? [{ field: "address" as const, label: "Recipient address (USAspending)", value: address }] : []),
      ...(p.parent_name ? [{ field: "parent" as const, label: "Parent recipient (USAspending)", value: `${p.parent_name}${p.parent_uei ? ` (UEI ${p.parent_uei})` : ""}` }] : []),
      ...(p.alternate_names?.length ? [{ field: "other" as const, label: "Alternate names (USAspending)", value: p.alternate_names.slice(0, 6).join("; ") }] : []),
    ];
    const evidence = inputs.map((f) => fact("usaspending", { ...f, url }, res.at, res.cached));
    const summary = clip(`USAspending recipient ${p.name}${p.uei ? ` (UEI ${p.uei})` : ""}: ${address ? `address ${address}; ` : "no address on record; "}${p.parent_name ? `parent ${p.parent_name}; ` : ""}${p.alternate_names?.length ? `also known as ${p.alternate_names.slice(0, 4).join(", ")}.` : ""}`);
    return { evidence, summary };
  } catch {
    return unavailable("USAspending", "an unexpected error occurred");
  }
}
