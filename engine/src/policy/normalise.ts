// Small, pure helpers the gate and the stages share: names, domains, addresses, phones, account numbers.

const NAME_NOISE = new Set(["inc", "incorporated", "llc", "ltd", "limited", "corp", "corporation", "co", "company", "plc", "lp", "llp", "the", "and"]);

export function nameNorm(s: string): string {
  return s
    .toLowerCase()
    .replace(/\([^)]*\)/g, " ") // "(formerly Vectrus, Inc.)" is not part of the name
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !NAME_NOISE.has(w))
    .join(" ");
}

/** True when two company names are the same once suffixes and punctuation are ignored. */
export const sameName = (a: string, b: string): boolean => !!nameNorm(a) && nameNorm(a) === nameNorm(b);

/** Share of the shorter name's words found in the longer one (0..1). Used to call a name "related". */
export function nameOverlap(a: string, b: string): number {
  const wa = nameNorm(a).split(" ").filter(Boolean);
  const wb = new Set(nameNorm(b).split(" ").filter(Boolean));
  if (!wa.length || !wb.size) return 0;
  const shorter = wa.length <= wb.size ? wa : [...wb];
  const longer = wa.length <= wb.size ? wb : new Set(wa);
  return shorter.filter((w) => longer.has(w)).length / shorter.length;
}

const SECOND_LEVEL = new Set(["co.uk", "org.uk", "com.au", "co.nz", "co.jp", "com.br", "co.in"]);
/** "mail.boozallen.com" -> "boozallen.com". Good enough for matching sender domains against the vendor's. */
export function registrable(domain: string): string {
  const d = domain.toLowerCase().trim().replace(/^.*@/, "").replace(/\.$/, "");
  const parts = d.split(".");
  if (parts.length <= 2) return d;
  const last2 = parts.slice(-2).join(".");
  return SECOND_LEVEL.has(last2) ? parts.slice(-3).join(".") : last2;
}

export const domainOfAddress = (addr: string): string | null => {
  const m = /<?([^<>\s"]+@([^<>\s"]+))>?\s*$/.exec(addr.trim());
  return m ? m[2]!.toLowerCase().replace(/[>"]+$/, "") : null;
};

export function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array<number>(b.length).fill(0)]);
  for (let j = 1; j <= b.length; j++) dp[0]![j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i]![j] = Math.min(dp[i - 1]![j]! + 1, dp[i]![j - 1]! + 1, dp[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length]![b.length]!;
}

/** The on-file domain a sender domain imitates, if any: close in spelling, or the vendor's name inside another domain. */
export function lookalikeOf(sender: string, onFile: string[]): string | null {
  const s = registrable(sender).split(".")[0]!;
  for (const d of onFile) {
    const base = registrable(d).split(".")[0]!;
    if (!base || registrable(sender) === registrable(d)) continue;
    if (editDistance(s, base) <= 2 || s.includes(base) || base.includes(s)) return registrable(d);
  }
  return null;
}

export const digits = (s: string): string => s.replace(/\D/g, "");

/** (703) 902-5000 from any US-looking number; null when it is not ten digits (after a leading 1). */
export function formatPhone(s: string): string | null {
  const d = digits(s);
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : null;
}

export const phoneKey = (s: string): string | null => {
  const f = formatPhone(s);
  return f ? digits(f) : null;
};

/** Every phone number written inside a piece of text. */
export function phonesIn(text: string): string[] {
  const out = new Set<string>();
  for (const m of text.matchAll(/(?:\+?1[\s.-]?)?\(?\b\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g)) {
    const f = formatPhone(m[0]);
    if (f) out.add(f);
  }
  return [...out];
}

const STREET: Record<string, string> = { drive: "dr", street: "st", avenue: "ave", road: "rd", boulevard: "blvd", lane: "ln", court: "ct", way: "way", suite: "ste", floor: "fl", place: "pl", parkway: "pkwy", trail: "trl", highway: "hwy" };

const TYPES = new Set(Object.values(STREET).filter((v) => !["ste", "fl"].includes(v)));
const DIRS = new Set(["ne", "nw", "se", "sw", "n", "s", "e", "w"]);

/** Reduces an address to "number street-words zip5" so that "Drive" and "Dr", a suite, or a missing zip do not matter. */
export function addrKey(address: string): { number: string; street: string; zip: string | null } | null {
  const t = address.toLowerCase().replace(/[.,#]/g, " ").replace(/\s+/g, " ").trim();
  const m = /\b(\d{1,6})\s+(.+)$/.exec(t);
  if (!m) return null;
  const words = m[2]!.split(" ").map((w) => STREET[w] ?? w);
  const typeAt = words.findIndex((w, i) => i > 0 && TYPES.has(w));
  const street = (typeAt >= 0 ? words.slice(0, typeAt + 1) : words.slice(0, 2)).filter((w) => !DIRS.has(w)).join(" ");
  const zip = /\b(\d{5})(?:-\d{4})?\s*$/.exec(t);
  return { number: m[1]!, street, zip: zip ? zip[1]! : null };
}

export function addressesMatch(a: string, b: string): boolean {
  const ka = addrKey(a);
  const kb = addrKey(b);
  if (!ka || !kb) return false;
  return ka.number === kb.number && ka.street === kb.street && (!ka.zip || !kb.zip || ka.zip === kb.zip);
}

export const maskAccount = (acct: string): string => {
  const d = digits(acct);
  return d.length >= 4 ? `••••${d.slice(-4)}` : "••••";
};

/** Replaces every long digit run (an account number) inside text with its masked form. */
export const maskAccountsIn = (text: string): string => text.replace(/\b\d{8,17}\b/g, (m) => maskAccount(m));

export function validAba(routing: string): boolean {
  const d = digits(routing);
  if (d.length !== 9) return false;
  const n = [...d].map(Number);
  return (3 * (n[0]! + n[3]! + n[6]!) + 7 * (n[1]! + n[4]! + n[7]!) + (n[2]! + n[5]! + n[8]!)) % 10 === 0;
}
