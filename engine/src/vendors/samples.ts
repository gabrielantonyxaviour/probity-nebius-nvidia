// Copy the demo company's sample vendors into a company, so a new company can run a real check straight away.
// Every copied id is the original behind an org-scoped prefix (vendor ids are global), and every insert is OR IGNORE: a second call adds nothing.
import { DEMO_ORG_ID } from "@probity/shared";
import type { Env } from "../env";
import { sha256Hex } from "../integrations/util";
import { hasName, flush, vendorNames } from "./store";

type Db = Pick<Env, "DB">;

export const samplePrefix = async (orgId: string): Promise<string> => `smp_${(await sha256Hex(orgId)).slice(0, 10)}_`;

export async function copySamples(env: Db, orgId: string, now: string): Promise<{ added: number; skipped: number }> {
  if (orgId === DEMO_ORG_ID) return { added: 0, skipped: 0 };
  const p = await samplePrefix(orgId);
  const source = await env.DB.prepare("SELECT vendor_id, legal_name FROM vendors WHERE org_id = ?1 AND status = 'active' ORDER BY vendor_id").bind(DEMO_ORG_ID).all<{ vendor_id: string; legal_name: string }>();
  const have = new Set((await env.DB.prepare("SELECT vendor_id FROM vendors WHERE org_id = ?1 AND vendor_id LIKE ?2").bind(orgId, `${p}%`).all<{ vendor_id: string }>()).results.map((r) => r.vendor_id));
  const names = await vendorNames(env, orgId); // a vendor the company already has under that name is not copied twice
  let skipped = 0;
  const groups: D1PreparedStatement[][] = [];
  const q = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args);
  for (const s of source.results) {
    const id = `${p}${s.vendor_id}`;
    if (have.has(id) || hasName(names, s.legal_name)) { skipped++; continue; }
    const from = s.vendor_id;
    groups.push([
      q("INSERT OR IGNORE INTO vendors (vendor_id, legal_name, legal_name_norm, is_fictional, uei, registrant_cik, remit_line1, remit_unit, remit_city, remit_state, remit_zip, status, merged_into, legacy_vendor_no, created_at, org_id, source) SELECT ?1 || vendor_id, legal_name, legal_name_norm, is_fictional, uei, registrant_cik, remit_line1, remit_unit, remit_city, remit_state, remit_zip, status, NULL, legacy_vendor_no, ?3, ?4, 'sample' FROM vendors WHERE vendor_id = ?2 AND org_id = ?5", p, from, now, orgId, DEMO_ORG_ID),
      q("INSERT OR IGNORE INTO vendor_bank_accounts (bank_account_id, vendor_id, bank_name, routing, account_last4, account_hash, status, changed_at, source_request_id) SELECT ?1 || bank_account_id, ?1 || vendor_id, bank_name, routing, account_last4, account_hash, status, changed_at, NULL FROM vendor_bank_accounts WHERE vendor_id = ?2", p, from),
      q("INSERT OR IGNORE INTO vendor_contacts (contact_id, vendor_id, kind, value, valid_from, valid_to, changed_via) SELECT ?1 || contact_id, ?1 || vendor_id, kind, value, valid_from, valid_to, changed_via FROM vendor_contacts WHERE vendor_id = ?2", p, from),
      q("INSERT OR IGNORE INTO vendor_domains (vendor_id, domain, added_at) SELECT ?1 || vendor_id, domain, added_at FROM vendor_domains WHERE vendor_id = ?2", p, from),
      q("INSERT OR IGNORE INTO vendor_remit_history (remit_id, vendor_id, line1, unit, city, state, zip, valid_from, valid_to, changed_via, source_request_id) SELECT ?1 || remit_id, ?1 || vendor_id, line1, unit, city, state, zip, valid_from, valid_to, changed_via, NULL FROM vendor_remit_history WHERE vendor_id = ?2", p, from),
      q("INSERT OR IGNORE INTO ap_invoices (invoice_no, vendor_id, amount_cents, invoice_date, status) SELECT ?1 || invoice_no, ?1 || vendor_id, amount_cents, invoice_date, status FROM ap_invoices WHERE vendor_id = ?2", p, from),
      q("INSERT OR IGNORE INTO payment_run_items (item_id, payment_run_id, vendor_id, invoice_no, bank_account_id, amount_cents) SELECT ?1 || item_id, payment_run_id, ?1 || vendor_id, ?1 || invoice_no, ?1 || bank_account_id, amount_cents FROM payment_run_items WHERE vendor_id = ?2", p, from),
    ]);
  }
  await flush(env, groups);
  return { added: groups.length, skipped };
}
