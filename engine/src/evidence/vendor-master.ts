// The payer's own vendor master (D1). Account numbers are never stored in full: only the last four digits are ever shown.
import { clip, fact, formatAddress, type EvidenceEnv, type ToolResult } from "./types";

type VendorRow = { vendor_id: string; legal_name: string; status: string; merged_into: string | null; remit_line1: string | null; remit_unit: string | null; remit_city: string | null; remit_state: string | null; remit_zip: string | null; uei: string | null; registrant_cik: string | null };
type AccountRow = { bank_name: string; routing: string; account_last4: string; status: string; changed_at: string };
type HistRow = { line1: string; unit: string | null; city: string; state: string; zip: string; valid_from: string; valid_to: string | null };

export const mask = (last4: string): string => `••••${last4}`;
export const remitAddress = (v: Pick<VendorRow, "remit_line1" | "remit_unit" | "remit_city" | "remit_state" | "remit_zip">): string =>
  formatAddress([formatAddress([v.remit_line1, v.remit_unit]), v.remit_city, `${v.remit_state ?? ""} ${v.remit_zip ?? ""}`.trim()]);

export type VendorOnFile = { vendorId: string; legalName: string; status: string; mergedInto: string | null; remitAddress: string; phone: string | null; domain: string | null; domains: string[]; accountMasked: string; bankName: string | null; uei: string | null; cik: string | null };

/** The vendor's current record: remit address, active account (masked), current phone and domains. null when the vendor id is unknown. */
export async function loadVendor(env: Pick<EvidenceEnv, "DB">, vendorId: string): Promise<VendorOnFile | null> {
  const v = await env.DB.prepare("SELECT vendor_id, legal_name, status, merged_into, remit_line1, remit_unit, remit_city, remit_state, remit_zip, uei, registrant_cik FROM vendors WHERE vendor_id = ?1").bind(vendorId).first<VendorRow>();
  if (!v) return null;
  const [acct, phone, domains] = await Promise.all([
    env.DB.prepare("SELECT bank_name, routing, account_last4, status, changed_at FROM vendor_bank_accounts WHERE vendor_id = ?1 AND status = 'active' ORDER BY changed_at DESC LIMIT 1").bind(vendorId).first<AccountRow>(),
    env.DB.prepare("SELECT value FROM vendor_contacts WHERE vendor_id = ?1 AND kind = 'phone' AND valid_to IS NULL ORDER BY valid_from DESC LIMIT 1").bind(vendorId).first<{ value: string }>(),
    env.DB.prepare("SELECT domain FROM vendor_domains WHERE vendor_id = ?1 ORDER BY added_at").bind(vendorId).all<{ domain: string }>(),
  ]);
  const doms = domains.results.map((d) => d.domain);
  return { vendorId, legalName: v.legal_name, status: v.status, mergedInto: v.merged_into, remitAddress: remitAddress(v), phone: phone?.value ?? null, domain: doms[0] ?? null, domains: doms, accountMasked: acct ? mask(acct.account_last4) : "no active account", bankName: acct?.bank_name ?? null, uei: v.uei, cik: v.registrant_cik };
}

export async function vendorMaster(env: EvidenceEnv, q: { vendorId: string }): Promise<ToolResult> {
  try {
    const v = await loadVendor(env, q.vendorId);
    if (!v) return { evidence: [], summary: `No vendor ${q.vendorId} exists in the vendor master.` };
    const now = new Date().toISOString();
    const hist = await env.DB.prepare("SELECT line1, unit, city, state, zip, valid_from, valid_to FROM vendor_remit_history WHERE vendor_id = ?1 ORDER BY valid_from").bind(q.vendorId).all<HistRow>();
    const history = hist.results.map((h) => `${remitAddress({ remit_line1: h.line1, remit_unit: h.unit, remit_city: h.city, remit_state: h.state, remit_zip: h.zip })} (${h.valid_from.slice(0, 10)} to ${h.valid_to ? h.valid_to.slice(0, 10) : "now"})`);
    const f = (field: Parameters<typeof fact>[1]["field"], label: string, value: string) => fact("vendor_master", { field, label, value }, now, false);
    const evidence = [
      f("legal_name", "Legal name on file", v.legalName),
      ...(v.remitAddress ? [f("address", "Remit-to address on file", v.remitAddress)] : []),
      f("bank_account", "Bank account on file", `${v.bankName ? `${v.bankName} ` : ""}${v.accountMasked}`),
      ...(v.phone ? [f("phone", "Phone on file", v.phone)] : []),
      ...v.domains.map((d) => f("domain", "E-mail domain on file", d)),
      ...(v.uei ? [f("identifier", "UEI on file", v.uei)] : []),
      ...(history.length > 1 ? [f("other", "Remit address history", history.join("; "))] : []),
      ...(v.mergedInto ? [f("other", "Vendor record status", `merged into ${v.mergedInto}`)] : []),
    ];
    const summary = clip(`Vendor master for ${v.legalName} (${v.vendorId}, ${v.status}${v.mergedInto ? `, merged into ${v.mergedInto}` : ""}): remit-to ${v.remitAddress || "none"}; account on file ${v.bankName ?? ""} ${v.accountMasked}; phone ${v.phone ?? "none"}; domains ${v.domains.join(", ") || "none"}; ${history.length} remit address${history.length === 1 ? "" : "es"} on record.`);
    return { evidence, summary };
  } catch {
    return { evidence: [], summary: "The vendor master could not be read." };
  }
}
