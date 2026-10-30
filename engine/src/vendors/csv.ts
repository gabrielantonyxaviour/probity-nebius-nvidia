// A defensive CSV reader: quoted fields, "" escapes, commas and line breaks inside quotes, CRLF / CR / LF, a BOM, and a trailing blank line.
export function parseCsv(text: string): string[][] {
  const src = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  let touched = false; // anything seen on this line, so a blank line is not a row
  const endField = () => { row.push(field); field = ""; };
  const endRow = () => {
    endField();
    if (touched) rows.push(row);
    row = [];
    touched = false;
  };
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]!;
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i++; } else quoted = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === "") { quoted = true; touched = true; }
    else if (ch === ",") { endField(); touched = true; }
    else if (ch === "\r" || ch === "\n") { if (ch === "\r" && src[i + 1] === "\n") i++; endRow(); }
    else { field += ch; touched = true; }
  }
  if (touched || field !== "" || row.length) endRow();
  return rows.filter((r) => r.some((f) => f.trim() !== ""));
}

const ALIASES: Record<string, string[]> = {
  name: ["name", "vendor", "vendor name", "legal name", "legal_name", "legalname", "company"],
  domain: ["domain", "domains", "email domain", "email_domain", "e-mail domain", "website"],
  phone: ["phone", "phone number", "telephone", "tel"],
  bank_name: ["bank_name", "bank name", "bank", "bankname"],
  routing: ["routing", "routing number", "routing_number", "aba"],
  account: ["account", "account number", "account_number", "acct"],
};
export type CsvColumn = keyof typeof ALIASES;
const canon = (h: string): CsvColumn | null => {
  const k = h.trim().toLowerCase();
  return (Object.keys(ALIASES).find((c) => ALIASES[c]!.includes(k)) as CsvColumn | undefined) ?? null;
};

/** Header row -> column index by name (aliases allowed). Returns null when there is no name column. */
export function readHeader(header: string[]): Partial<Record<CsvColumn, number>> | null {
  const idx: Partial<Record<CsvColumn, number>> = {};
  header.forEach((h, i) => {
    const c = canon(h);
    if (c && idx[c] === undefined) idx[c] = i;
  });
  return idx.name === undefined ? null : idx;
}

/** A cell that may hold several domains ("a.com; b.com", "ap@a.com"): each reduced to its host, lowercased. */
export function domainsOf(cell: string): string[] {
  return cell
    .split(/[;|,\s]+/)
    .map((d) => d.trim().toLowerCase().replace(/^https?:\/\//, "").replace(/^.*@/, "").replace(/^www\./, "").replace(/[/?#].*$/, ""))
    .filter(Boolean);
}
