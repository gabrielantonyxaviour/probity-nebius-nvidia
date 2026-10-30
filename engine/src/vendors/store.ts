// Reading and writing a company's vendor list. Every query carries the org id; vendor ids are global, so new ids are random.
import { DEMO_ORG_ID, type Vendor } from "@probity/shared";
import type { Env } from "../env";
import { sha256Hex } from "../integrations/util";
import { sameName } from "../policy/normalise";

export const MAX_LIST = 500;
export const MAX_VENDORS = 1000; // per company; a hand-kept list never needs more
export const HIDDEN = "('merged','unknown')"; // statuses that are not vendors of record (merged duplicates, the "Unknown sender" placeholder)

type Db = Pick<Env, "DB">;
export type Parsed = { legalName: string; domains: string[]; phone?: string | undefined; bank?: { bankName: string; routing: string; accountLast4?: string | undefined; account?: string | undefined } | undefined };

const normName = (n: string): string => n.toUpperCase().replace(/[^A-Z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

export async function listVendors(env: Db, orgId: string): Promise<Vendor[]> {
  const v = await env.DB.prepare(`SELECT vendor_id, legal_name, source, status, created_at FROM vendors WHERE org_id = ?1 AND status NOT IN ${HIDDEN} ORDER BY legal_name_norm, vendor_id LIMIT ${MAX_LIST}`).bind(orgId).all<{ vendor_id: string; legal_name: string; source: string; status: string; created_at: string }>();
  if (!v.results.length) return [];
  const [doms, phones, banks] = await Promise.all([
    env.DB.prepare(`SELECT d.vendor_id, d.domain FROM vendor_domains d JOIN vendors v ON v.vendor_id = d.vendor_id WHERE v.org_id = ?1 AND v.status NOT IN ${HIDDEN} ORDER BY d.added_at, d.domain`).bind(orgId).all<{ vendor_id: string; domain: string }>(),
    env.DB.prepare(`SELECT c.vendor_id, c.value FROM vendor_contacts c JOIN vendors v ON v.vendor_id = c.vendor_id WHERE v.org_id = ?1 AND v.status NOT IN ${HIDDEN} AND c.kind = 'phone' AND c.valid_to IS NULL ORDER BY c.valid_from DESC`).bind(orgId).all<{ vendor_id: string; value: string }>(),
    env.DB.prepare(`SELECT a.vendor_id, a.bank_name, a.account_last4 FROM vendor_bank_accounts a JOIN vendors v ON v.vendor_id = a.vendor_id WHERE v.org_id = ?1 AND v.status NOT IN ${HIDDEN} AND a.status = 'active' ORDER BY a.changed_at DESC`).bind(orgId).all<{ vendor_id: string; bank_name: string; account_last4: string }>(),
  ]);
  const domains = new Map<string, string[]>();
  for (const d of doms.results) domains.set(d.vendor_id, [...(domains.get(d.vendor_id) ?? []), d.domain]);
  const phone = new Map<string, string>();
  for (const p of phones.results) if (!phone.has(p.vendor_id)) phone.set(p.vendor_id, p.value); // newest first
  const bank = new Map<string, { bankName: string; last4: string }>();
  for (const b of banks.results) if (!bank.has(b.vendor_id)) bank.set(b.vendor_id, { bankName: b.bank_name, last4: b.account_last4 });
  return v.results.map((r) => ({
    id: r.vendor_id,
    legalName: r.legal_name,
    source: orgId === DEMO_ORG_ID || r.source === "sample" ? "sample" : r.source === "xero" ? "xero" : "manual", // the demo company is all sample data, even after a re-seed
    status: r.status === "active" ? "active" : "inactive",
    domains: domains.get(r.vendor_id) ?? [],
    phone: phone.get(r.vendor_id) ?? null,
    bank: bank.get(r.vendor_id) ?? null,
    createdAt: r.created_at,
  }));
}

/** The company's current vendor names, for duplicate checks (names compare the way matchVendor compares them). */
export async function vendorNames(env: Db, orgId: string): Promise<string[]> {
  const r = await env.DB.prepare(`SELECT legal_name FROM vendors WHERE org_id = ?1 AND status NOT IN ${HIDDEN}`).bind(orgId).all<{ legal_name: string }>();
  return r.results.map((x) => x.legal_name);
}
export const hasName = (names: string[], name: string): boolean => names.some((n) => sameName(n, name));

/** The statements that add one manual vendor. A full account number is hashed (as the check hashes a letter's) and reduced to its last 4. */
export async function vendorStatements(env: Db, orgId: string, input: Parsed, now: string): Promise<{ vendor: Vendor; stmts: D1PreparedStatement[] }> {
  const id = `man_${crypto.randomUUID().replace(/-/g, "").slice(0, 20)}`;
  const q = (sql: string, ...args: unknown[]) => env.DB.prepare(sql).bind(...args);
  const stmts = [
    q("INSERT INTO vendors (vendor_id, legal_name, legal_name_norm, is_fictional, status, created_at, org_id, source) VALUES (?1,?2,?3,0,'active',?4,?5,'manual')", id, input.legalName, normName(input.legalName), now, orgId),
  ];
  for (const d of uniq(input.domains)) stmts.push(q("INSERT OR IGNORE INTO vendor_domains (vendor_id, domain, added_at) VALUES (?1,?2,?3)", id, d, now));
  if (input.phone) stmts.push(q("INSERT INTO vendor_contacts (contact_id, vendor_id, kind, value, valid_from, valid_to, changed_via) VALUES (?1,?2,'phone',?3,?4,NULL,'manual')", `${id}_ph`, id, input.phone, now));
  const b = input.bank;
  if (b) {
    const last4 = b.account ? b.account.slice(-4) : b.accountLast4!;
    const hash = await sha256Hex(`${b.routing}:${b.account ?? last4}`); // the vendor master's hash is sha256("routing:account"); with only the last 4 it can never match a letter, by design
    stmts.push(q("INSERT INTO vendor_bank_accounts (bank_account_id, vendor_id, bank_name, routing, account_last4, account_hash, status, changed_at) VALUES (?1,?2,?3,?4,?5,?6,'active',?7)", `${id}_ba`, id, b.bankName, b.routing, last4, hash, now));
  }
  const vendor: Vendor = { id, legalName: input.legalName, source: "manual", status: "active", domains: uniq(input.domains), phone: input.phone ?? null, bank: b ? { bankName: b.bankName, last4: b.account ? b.account.slice(-4) : b.accountLast4! } : null, createdAt: now };
  return { vendor, stmts };
}

/** Runs whole vendors per batch (a vendor's rows land together or not at all). */
export async function flush(env: Db, groups: D1PreparedStatement[][]): Promise<void> {
  let cur: D1PreparedStatement[] = [];
  for (const g of groups) {
    if (cur.length && cur.length + g.length > 50) { await env.DB.batch(cur); cur = []; }
    cur.push(...g);
  }
  if (cur.length) await env.DB.batch(cur);
}

export async function vendorCount(env: Db, orgId: string): Promise<number> {
  const r = await env.DB.prepare(`SELECT COUNT(*) AS n FROM vendors WHERE org_id = ?1 AND status NOT IN ${HIDDEN}`).bind(orgId).first<{ n: number }>();
  return r?.n ?? 0;
}
