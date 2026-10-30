// Xero as the vendor master: contacts (with bank account details) and open supplier bills, read through Composio and synced to D1 hourly.
import { z } from "zod";
import { executeTool } from "./composio";
import type { IntEnv } from "./env";
import { nowIso } from "./env";
import { getConn } from "./store";
import { asObject, sha256Hex } from "./util";

const HOUR = 60 * 60_000;
const MAX_PAGES = 10;

const Phone = z.object({ PhoneType: z.string().optional(), PhoneNumber: z.string().nullish(), PhoneAreaCode: z.string().nullish(), PhoneCountryCode: z.string().nullish() });
const Address = z.object({ AddressType: z.string().optional(), AddressLine1: z.string().nullish(), AddressLine2: z.string().nullish(), City: z.string().nullish(), Region: z.string().nullish(), PostalCode: z.string().nullish() });
export const XeroContact = z.object({
  ContactID: z.string(),
  Name: z.string(),
  EmailAddress: z.string().nullish(),
  ContactStatus: z.string().optional(),
  BankAccountDetails: z.string().nullish(),
  Phones: z.array(Phone).default([]),
  Addresses: z.array(Address).default([]),
});
export type XeroContact = z.infer<typeof XeroContact>;
export const XeroBill = z.object({ InvoiceID: z.string(), InvoiceNumber: z.string().nullish(), Type: z.string().optional(), Status: z.string(), AmountDue: z.number(), CurrencyCode: z.string().nullish(), DueDate: z.string().nullish(), Contact: z.object({ ContactID: z.string() }) });
export type XeroBill = z.infer<typeof XeroBill>;

/** Xero's legacy "/Date(1698710400000+0000)/" and ISO forms -> YYYY-MM-DD. */
export function xeroDate(v: string | null | undefined): string | null {
  if (!v) return null;
  const m = /\/Date\((\d+)/.exec(v);
  if (m?.[1]) return new Date(Number(m[1])).toISOString().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}/.test(v) ? v.slice(0, 10) : null;
}

const norm = (n: string): string => n.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const list = <T>(data: unknown, key: string, item: z.ZodType<T, z.ZodTypeDef, unknown>): T[] => {
  const root = asObject(data) as Record<string, unknown> | unknown[] | null;
  const arr = Array.isArray(root) ? root : ((root as Record<string, unknown> | null)?.[key] ?? (root as { response_data?: Record<string, unknown> } | null)?.response_data?.[key] ?? (root as { data?: Record<string, unknown> } | null)?.data?.[key]);
  return Array.isArray(arr) ? arr.flatMap((x) => { const p = item.safeParse(x); return p.success ? [p.data] : []; }) : [];
};

const phoneOf = (c: XeroContact): string | null => {
  const p = c.Phones.find((x) => x.PhoneType === "DEFAULT" && x.PhoneNumber) ?? c.Phones.find((x) => x.PhoneNumber);
  return p?.PhoneNumber ? [p.PhoneCountryCode ? `+${p.PhoneCountryCode}` : "", p.PhoneAreaCode ?? "", p.PhoneNumber].filter(Boolean).join(" ") : null;
};

export async function syncXero(env: IntEnv, orgId: string, opts: { force?: boolean } = {}): Promise<{ vendors: number; bills: number } | null> {
  const conn = await getConn(env, orgId, "xero");
  if (!conn || conn.status !== "connected" || !conn.connected_account_id) return null;
  const last = await env.DB.prepare("SELECT synced_at, status, vendors, bills FROM xero_sync WHERE org_id = ?1").bind(orgId).first<{ synced_at: string | null; status: string; vendors: number; bills: number }>();
  if (!opts.force && last?.status === "ok" && last.synced_at && Date.now() - Date.parse(last.synced_at) < HOUR) return { vendors: last.vendors, bills: last.bills };
  try {
    const contacts: XeroContact[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await executeTool(env, "XERO_GET_CONTACTS", orgId, conn.connected_account_id, { page, pageSize: 100, includeArchived: false });
      if (!r.successful) throw new Error(r.error ?? "contacts");
      const got = list(r.data, "Contacts", XeroContact);
      contacts.push(...got);
      if (got.length < 100) break;
    }
    const bills: XeroBill[] = [];
    for (let page = 1; page <= MAX_PAGES; page++) {
      const r = await executeTool(env, "XERO_LIST_INVOICES", orgId, conn.connected_account_id, { page, Statuses: "AUTHORISED,SUBMITTED", where: 'Type=="ACCPAY"' });
      if (!r.successful) throw new Error(r.error ?? "bills");
      const got = list(r.data, "Invoices", XeroBill).filter((b) => b.Type === undefined || b.Type === "ACCPAY");
      bills.push(...got);
      if (got.length < 100) break;
    }
    await writeMaster(env, orgId, contacts, bills);
    await env.DB.prepare("INSERT INTO xero_sync (org_id, synced_at, status, detail, vendors, bills) VALUES (?1,?2,'ok',NULL,?3,?4) ON CONFLICT(org_id) DO UPDATE SET synced_at=excluded.synced_at, status='ok', detail=NULL, vendors=excluded.vendors, bills=excluded.bills").bind(orgId, nowIso(), contacts.length, bills.length).run();
    return { vendors: contacts.length, bills: bills.length };
  } catch (e) {
    await env.DB.prepare("INSERT INTO xero_sync (org_id, synced_at, status, detail) VALUES (?1, ?2, 'error', ?3) ON CONFLICT(org_id) DO UPDATE SET status='error', detail=excluded.detail").bind(orgId, last?.synced_at ?? null, (e instanceof Error ? e.message : "sync failed").slice(0, 200)).run();
    return null;
  }
}

async function writeMaster(env: IntEnv, orgId: string, contacts: XeroContact[], bills: XeroBill[]): Promise<void> {
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  const q = (sql: string, ...args: unknown[]) => stmts.push(env.DB.prepare(sql).bind(...args));
  for (const c of contacts) {
    const id = `xero_${c.ContactID}`;
    const addr = c.Addresses.find((a) => a.AddressType === "STREET" && a.AddressLine1) ?? c.Addresses.find((a) => a.AddressLine1);
    q("INSERT INTO vendors (vendor_id, legal_name, legal_name_norm, is_fictional, status, remit_line1, remit_unit, remit_city, remit_state, remit_zip, created_at, org_id, source) VALUES (?1,?2,?3,0,?4,?5,?6,?7,?8,?9,?10,?11,'xero') ON CONFLICT(vendor_id) DO UPDATE SET legal_name=excluded.legal_name, legal_name_norm=excluded.legal_name_norm, status=excluded.status, remit_line1=excluded.remit_line1, remit_unit=excluded.remit_unit, remit_city=excluded.remit_city, remit_state=excluded.remit_state, remit_zip=excluded.remit_zip",
      id, c.Name, norm(c.Name), c.ContactStatus === "ACTIVE" || !c.ContactStatus ? "active" : "inactive", addr?.AddressLine1 ?? null, addr?.AddressLine2 ?? null, addr?.City ?? null, addr?.Region ?? null, addr?.PostalCode ?? null, now, orgId);
    q("DELETE FROM vendor_bank_accounts WHERE vendor_id = ?1", id);
    const digits = (c.BankAccountDetails ?? "").replace(/\D/g, "");
    if (digits.length >= 4) q("INSERT INTO vendor_bank_accounts (bank_account_id, vendor_id, bank_name, routing, account_last4, account_hash, status, changed_at) VALUES (?1,?2,'Bank account in Xero','',?3,?4,'active',?5)", `xero_ba_${c.ContactID}`, id, digits.slice(-4), await sha256Hex(digits), now);
    q("DELETE FROM vendor_contacts WHERE vendor_id = ?1", id);
    const phone = phoneOf(c);
    if (phone) q("INSERT INTO vendor_contacts (contact_id, vendor_id, kind, value, valid_from, valid_to, changed_via) VALUES (?1,?2,'phone',?3,?4,NULL,'xero')", `xero_ph_${c.ContactID}`, id, phone, now);
    q("DELETE FROM vendor_domains WHERE vendor_id = ?1", id);
    const domain = c.EmailAddress?.split("@")[1]?.toLowerCase();
    if (c.EmailAddress) q("INSERT INTO vendor_contacts (contact_id, vendor_id, kind, value, valid_from, valid_to, changed_via) VALUES (?1,?2,'email',?3,?4,NULL,'xero')", `xero_em_${c.ContactID}`, id, c.EmailAddress, now);
    if (domain) q("INSERT OR IGNORE INTO vendor_domains (vendor_id, domain, added_at) VALUES (?1,?2,?3)", id, domain, now);
  }
  q("DELETE FROM xero_bills WHERE org_id = ?1", orgId);
  for (const b of bills) q("INSERT OR REPLACE INTO xero_bills (org_id, invoice_id, vendor_id, number, amount_due_cents, currency, due_date, status) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)", orgId, b.InvoiceID, `xero_${b.Contact.ContactID}`, b.InvoiceNumber ?? null, Math.round(b.AmountDue * 100), b.CurrencyCode ?? null, xeroDate(b.DueDate), b.Status);
  for (let i = 0; i < stmts.length; i += 50) await env.DB.batch(stmts.slice(i, i + 50));
}

/** What a payment to this vendor would put at risk: open bills' amount due, and the earliest due date (null when none). */
export async function xeroAmountAtRisk(env: IntEnv, orgId: string, vendorId: string): Promise<{ cents: number; nextDue: string | null; bills: number } | null> {
  if (!vendorId.startsWith("xero_")) return null;
  await syncXero(env, orgId);
  const r = await env.DB.prepare("SELECT COALESCE(SUM(amount_due_cents),0) AS cents, MIN(due_date) AS next_due, COUNT(*) AS n FROM xero_bills WHERE org_id = ?1 AND vendor_id = ?2").bind(orgId, vendorId).first<{ cents: number; next_due: string | null; n: number }>();
  return { cents: r?.cents ?? 0, nextDue: r?.next_due ?? null, bills: r?.n ?? 0 };
}
