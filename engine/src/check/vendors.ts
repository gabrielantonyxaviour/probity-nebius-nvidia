// Which vendor of a company is this request about? By the sender's domain first, then by name. Never guesses between two.
import type { Env } from "../env";
import { domainOfAddress, nameOverlap, registrable, sameName } from "../policy/normalise";

export type VendorMatch = { vendorId: string; legalName: string; how: "domain" | "name" };
export type MatchResult = { match: VendorMatch } | { none: true } | { ambiguous: string[] };

export async function matchVendor(env: Pick<Env, "DB">, orgId: string, o: { from: string; names: string[] }): Promise<MatchResult> {
  const sender = domainOfAddress(o.from);
  if (sender) {
    const rows = await env.DB.prepare(
      "SELECT DISTINCT v.vendor_id, v.legal_name FROM vendor_domains d JOIN vendors v ON v.vendor_id = d.vendor_id WHERE v.org_id = ?1 AND v.status != 'merged' AND (d.domain = ?2 OR d.domain = ?3)",
    ).bind(orgId, sender, registrable(sender)).all<{ vendor_id: string; legal_name: string }>();
    if (rows.results.length === 1) return { match: { vendorId: rows.results[0]!.vendor_id, legalName: rows.results[0]!.legal_name, how: "domain" } };
    if (rows.results.length > 1) return { ambiguous: rows.results.map((r) => r.legal_name) };
  }
  const vendors = await env.DB.prepare("SELECT vendor_id, legal_name FROM vendors WHERE org_id = ?1 AND status != 'merged'").bind(orgId).all<{ vendor_id: string; legal_name: string }>();
  const names = o.names.filter((n) => n.trim().length >= 2);
  const ranked = vendors.results
    .map((v) => ({ v, score: Math.max(0, ...names.map((n) => (sameName(v.legal_name, n) ? 2 : nameOverlap(v.legal_name, n)))) }))
    .filter((r) => r.score >= 0.6)
    .sort((a, b) => b.score - a.score);
  const best = ranked[0];
  if (!best) return { none: true };
  if (ranked[1] && ranked[1].score === best.score && best.score < 2) return { ambiguous: ranked.filter((r) => r.score === best.score).map((r) => r.v.legal_name) };
  return { match: { vendorId: best.v.vendor_id, legalName: best.v.legal_name, how: "name" } };
}
