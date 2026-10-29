// The call card: who to call, never from the request itself, and what to ask.
// A number the letter also prints is fine when an independent source (SEC, the vendor master from before the request) has it too.
import type { CallCard, Evidence } from "@probity/shared";
import { digits, formatPhone, phoneKey, phonesIn } from "./normalise";
import { claimedNames } from "./rules";
import { LABEL, type GateInput } from "./types";

const INDEPENDENT = ["sec_edgar", "vendor_master", "tavily"] as const;
const rank = (e: Evidence) => INDEPENDENT.indexOf(e.source as (typeof INDEPENDENT)[number]);

const phoneOf = (e: Evidence): string | null => {
  const found = phonesIn(e.value)[0] ?? formatPhone(e.value);
  return found ?? null;
};

/** A phone on file that was changed shortly before the request may be the attacker's. The ledger marks it with this label. */

export function buildCallCard(i: GateInput): CallCard {
  const recent = new Set(i.evidence.filter((e) => e.label === LABEL.phoneRecent).map((e) => phoneKey(phonesIn(e.value)[0] ?? e.value)));
  const candidates = i.evidence
    .filter((e) => e.field === "phone" && e.label !== LABEL.phoneRecent && INDEPENDENT.includes(e.source as (typeof INDEPENDENT)[number]) && !recent.has(phoneKey(phoneOf(e) ?? e.value)))
    .map((e) => ({ e, phone: phoneOf(e) }))
    .filter((c): c is { e: Evidence; phone: string } => !!c.phone)
    .sort((a, b) => rank(a.e) - rank(b.e));
  const best = candidates[0];
  const sources = best
    ? candidates.filter((c) => digits(c.phone) === digits(best.phone)).map((c) => ({ evidenceId: c.e.id, source: c.e.source, label: c.e.label }))
    : [];
  return { phone: best?.phone ?? null, sources: sources.filter((s) => s.source !== "request"), letterPhones: i.letterPhones.filter((p) => !best || digits(p) !== digits(best.phone)), ask: askList(i) };
}

function askList(i: GateInput): string[] {
  const out: string[] = [];
  const bank = i.letter.claims.find((c) => c.field === "bank_name")?.value;
  const acct = i.letter.claims.find((c) => c.field === "account_number")?.value;
  out.push(
    acct
      ? `Ask them to say the bank and the last four digits of the account they expect us to pay. The letter says ${bank ? `${bank}, ` : ""}${acct}. Do not read it out first.`
      : "Ask them to say the bank and the last four digits of the account they expect us to pay.",
  );
  const addr = i.letter.claims.find((c) => c.field === "remit_address")?.value;
  if (addr) out.push(`Ask for the remit-to address they expect, and compare it with the letter: ${addr}.`);
  const avoid = i.pressure.find((p) => p.kind === "avoid_verification");
  const who = i.letter.claims.find((c) => c.field === "signatory")?.value ?? claimedNames(i)[0];
  if (avoid) out.push(`The letter asked you not to use the number on file. Ask whether ${who ?? "the sender"} really sent it, and why.`);
  else out.push(`Ask whether ${who ?? "the sender"} sent this request, and record the answer in Probity.`);
  return out.slice(0, 3);
}
