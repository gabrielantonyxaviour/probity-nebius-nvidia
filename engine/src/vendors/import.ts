// CSV -> vendors. Row numbers are the file's own (row 1 is the header), so they match what the person sees in a spreadsheet.
import { VendorInput, type ImportResult } from "@probity/shared";
import type { Env } from "../env";
import { domainsOf, parseCsv, readHeader, type CsvColumn } from "./csv";
import { flush, hasName, MAX_VENDORS, vendorCount, vendorNames, vendorStatements } from "./store";

export const MAX_ROWS = 500;
export const MAX_BYTES = 200 * 1024;

const COLUMN: Record<string, string> = { legalName: "name", domains: "domain", phone: "phone", "bank.bankName": "bank_name", "bank.routing": "routing", "bank.account": "account", "bank.accountLast4": "account", bank: "bank_name" };
const digitsOnly = (s: string): string => s.replace(/[\s-]/g, "");

/** Why a row was refused, in the CSV's own column names. */
export function reason(issue: { path: (string | number)[]; message: string }): string {
  const key = issue.path.slice(0, 2).join(".");
  const col = COLUMN[key] ?? COLUMN[String(issue.path[0])] ?? "";
  return col ? `${col}: ${issue.message}` : issue.message;
}

export type Prepared = { ok: true; rows: Array<{ row: number; input: ReturnType<typeof VendorInput.parse> }> } | { ok: false; code: "bad_csv" | "too_many_rows"; error: string };
export type RowIssue = { row: number; reason: string };

export function prepare(csv: string): Prepared & { skipped: RowIssue[] } {
  const skipped: RowIssue[] = [];
  const table = parseCsv(csv);
  const cols = table[0] ? readHeader(table[0]) : null;
  if (!cols) return { ok: false, code: "bad_csv", error: "The first row must be a header with at least a name column (name, domain, phone, bank_name, routing, account).", skipped };
  if (table.length - 1 > MAX_ROWS) return { ok: false, code: "too_many_rows", error: `Import at most ${MAX_ROWS} vendors at a time.`, skipped };
  const rows: Array<{ row: number; input: ReturnType<typeof VendorInput.parse> }> = [];
  table.slice(1).forEach((cells, i) => {
    const row = i + 2;
    const cell = (c: CsvColumn): string => (cols[c] === undefined ? "" : (cells[cols[c]!] ?? "").trim());
    const bankName = cell("bank_name");
    const routing = digitsOnly(cell("routing"));
    const account = digitsOnly(cell("account"));
    const parsed = VendorInput.safeParse({
      legalName: cell("name"),
      domains: domainsOf(cell("domain")),
      phone: cell("phone") || undefined,
      bank: bankName || routing || account ? { bankName, routing, account: account || undefined } : undefined,
    });
    if (parsed.success) rows.push({ row, input: parsed.data });
    else skipped.push({ row, reason: reason(parsed.error.issues[0]!) });
  });
  return { ok: true, rows, skipped };
}

export async function importVendors(env: Pick<Env, "DB">, orgId: string, rows: Array<{ row: number; input: ReturnType<typeof VendorInput.parse> }>, skipped: RowIssue[], now: string): Promise<ImportResult> {
  const names = await vendorNames(env, orgId);
  const seen = new Map<string, number>(); // a name already added by an earlier row of this file
  let room = MAX_VENDORS - (await vendorCount(env, orgId));
  const groups: D1PreparedStatement[][] = [];
  for (const { row, input } of rows) {
    if (hasName(names, input.legalName)) { skipped.push({ row, reason: "Already in your vendor list." }); continue; }
    const dup = [...seen].find(([n]) => hasName([n], input.legalName));
    if (dup) { skipped.push({ row, reason: `Same vendor as row ${dup[1]}.` }); continue; }
    if (room <= 0) { skipped.push({ row, reason: `Your vendor list is full (${MAX_VENDORS}).` }); continue; }
    room--;
    seen.set(input.legalName, row);
    groups.push((await vendorStatements(env, orgId, input, now)).stmts);
  }
  await flush(env, groups);
  return { added: groups.length, skipped: skipped.sort((a, b) => a.row - b.row) };
}
