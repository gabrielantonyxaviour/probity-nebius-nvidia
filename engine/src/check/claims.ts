// Turning a model's reading into Claims: guard against invented quotes, never keep a full account number.
import type { Claim } from "@probity/shared";
import { digits, maskAccount, nameNorm, validAba } from "../policy/normalise";
import type { RawClaim } from "./schemas";

const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, "");
export const contains = (haystack: string, needle: string) => !!alnum(needle) && alnum(haystack).includes(alnum(needle));

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** "000999000731" -> "09031". Vision models drop or add a zero inside a run of identical digits; a changed digit still shows. */
export const collapseRuns = (d: string): string => d.replace(/(\d)\1+/g, "$1");

export interface AccountRead {
  /** sha256("routing:account"), the vendor master's hash */
  hash: string;
  /** sha256 of the account digits alone: compares two readings even when one misread the routing number */
  digitsHash: string;
  last4: string;
  routing: string | null;
}

/** The account number as read, hashed the same way the vendor master hashes accounts: sha256("routing:account"). */
export async function accountOf(raw: RawClaim[]): Promise<AccountRead | null> {
  const acct = raw.find((c) => c.field === "account_number");
  const acctDigits = acct ? digits(acct.value) : "";
  if (acctDigits.length < 6) return null;
  const routing = digits(raw.find((c) => c.field === "routing_number")?.value ?? "") || null;
  return { hash: await sha256Hex(`${routing ?? ""}:${acctDigits}`), digitsHash: await sha256Hex(collapseRuns(acctDigits)), last4: acctDigits.slice(-4), routing };
}

/** Keeps claims whose quote (or value) is really in `sourceText` when one is given; masks account numbers. */
export function toClaims(raw: RawClaim[], sourceText: string | null, inImage: boolean): Claim[] {
  const seen = new Set<string>();
  const out: Claim[] = [];
  const acct = digits(raw.find((c) => c.field === "account_number")?.value ?? "");
  const maskIn = (t: string) => (acct.length >= 4 ? t.split(acct).join(maskAccount(acct)) : t);
  const hasRouting = raw.some((c) => c.field === "routing_number" && validAba(c.value));
  for (const c of raw) {
    if (c.field === "remit_address" && !/\d/.test(c.value)) continue; // "unchanged" is not an address
    if (c.field === "routing_number" && hasRouting && !validAba(c.value)) continue; // a misread routing number
    if (!c.value.trim()) continue;
    if (sourceText !== null && !contains(sourceText, c.quote) && !contains(sourceText, c.value)) continue;
    const isAcct = c.field === "account_number";
    if (isAcct && digits(c.value).length < 4) continue;
    const value = isAcct ? maskAccount(c.value) : c.field === "routing_number" ? digits(c.value) || c.value.trim() : c.value.trim();
    const key = `${c.field}|${nameNorm(value) || value}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ field: c.field, value, quote: maskIn(c.quote.trim()).slice(0, 300), inImage });
  }
  return out;
}

/** Do two readings of the same field say the same thing? Numbers by digits, everything else by words. */
export function sameClaimValue(field: string, a: string, b: string): boolean {
  if (field === "account_number" || field === "routing_number" || field === "phone") return !!digits(a) && collapseRuns(digits(a)).slice(-9) === collapseRuns(digits(b)).slice(-9);
  const x = alnum(a);
  const y = alnum(b);
  return !!x && !!y && (x === y || (Math.min(x.length, y.length) >= 5 && (x.includes(y) || y.includes(x))));
}
