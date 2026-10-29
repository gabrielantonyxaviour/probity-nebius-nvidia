// The clerk's note. Lightning writes it from the facts below; code then checks every number, phone and decision word
// in it against those facts. If the check fails twice, a template built only from the facts is used instead.
import type { Decision } from "@probity/shared";
import { digits, phonesIn } from "./normalise";
import type { GateInput } from "./types";

export interface RationaleFacts {
  verdict: Decision["verdict"];
  vendor: string;
  requestId: string;
  amountAtRisk: string;
  nextPaymentRun: string | null;
  reasons: string[];
  callThisNumber: string | null;
  numberSource: string | null;
  doNotCall: string[];
  callbackAlreadyConfirmed: boolean;
}

export const money = (cents: number): string => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export function rationaleFacts(i: GateInput, d: Decision, confirmed: boolean): RationaleFacts {
  const src = d.callCard.sources[0];
  return {
    verdict: d.verdict,
    vendor: i.request.vendorName,
    requestId: i.request.requestId,
    amountAtRisk: money(i.request.amountAtRisk.cents),
    nextPaymentRun: i.request.nextRunAt ? i.request.nextRunAt.slice(0, 10) : null,
    reasons: d.reasons.filter((r) => r.severity !== "info").slice(0, 4).map((r) => r.text),
    callThisNumber: d.callCard.phone,
    numberSource: src ? src.label : null,
    doNotCall: d.callCard.letterPhones,
    callbackAlreadyConfirmed: confirmed,
  };
}

const ABBREV = /\b(Inc|Corp|Co|Ltd|LLC|LLP|St|Dr|Mr|Ms|No|Jr|Sr|U\.S)\./g;
export const sentenceCount = (t: string): number =>
  t.replace(ABBREV, "$1").split(/(?<=[.!?])\s+(?=[A-Z0-9$"(])/).filter((s) => s.trim()).length;

export interface CheckResult {
  ok: boolean;
  failures: string[];
}

/** Every digit run and every phone number in the note must come from the facts; no other decision word; at most 3 sentences. */
export function checkRationale(text: string, facts: RationaleFacts): CheckResult {
  const failures: string[] = [];
  const corpus = JSON.stringify(facts);
  const allowedRuns = new Set(corpus.match(/\d+/g) ?? []);
  for (const run of text.match(/\d+/g) ?? []) if (!allowedRuns.has(run)) failures.push(`number ${run} is not in the facts`);

  const callKey = facts.callThisNumber ? digits(facts.callThisNumber) : null;
  const doNot = new Set(facts.doNotCall.map(digits));
  for (const p of phonesIn(text)) {
    const k = digits(p);
    if (k === callKey) continue;
    if (doNot.has(k)) {
      const sentence = text.split(/(?<=[.!?])\s+/).find((s) => s.includes(p.slice(-8)) || digits(s).includes(k)) ?? "";
      if (!/\b(not|never|instead|ignore|rather than|crossed)\b/i.test(sentence)) failures.push(`letter number ${p} offered as a number to call`);
    } else failures.push(`phone ${p} is not in the facts`);
  }
  for (const w of ["APPROVE", "HOLD", "CALLBACK_VERIFY"]) {
    if (w !== facts.verdict && new RegExp(`\\b${w}\\b`).test(text)) failures.push(`other decision word ${w}`);
  }
  if (/\b(fraud|fraudulent|scam|criminal)\b/i.test(text)) failures.push("accusing word");
  const n = sentenceCount(text);
  if (n < 1 || n > 3) failures.push(`${n} sentences`);
  return { ok: failures.length === 0, failures };
}

const strip = (s: string) => s.replace(/[.\s]+$/, "");
const WORDS = ["no", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine"];
/** First sentence of a reason, without its full stop (abbreviations such as "Inc." do not end it). */
const firstSentence = (s: string) => strip(s.replace(ABBREV, "$1\u0000").split(/(?<=[.!?])\s+/)[0]!.replace(/\u0000/g, "."));

/** Built only from the facts, so it always passes the check. */
export function templateRationale(f: RationaleFacts): string {
  const call = f.callThisNumber ? `Call ${f.callThisNumber}${f.numberSource ? ` (${f.numberSource})` : ""}` : null;
  const not = f.doNotCall.length ? ` and do not use ${f.doNotCall.join(", ")}` : "";
  const first = f.reasons[0] ? `${firstSentence(f.reasons[0])}.` : "";
  const n = f.reasons.length - 1;
  const more = n > 0 ? ` ${WORDS[Math.min(n, 9)]![0]!.toUpperCase()}${WORDS[Math.min(n, 9)]!.slice(1)} other ${n === 1 ? "concern also applies" : "concerns also apply"}.` : "";
  if (f.verdict === "HOLD") return `Hold the change for ${f.vendor}: ${first}${more} ${call ? `${call} to warn the vendor${not}.` : "Escalate to the contracting officer."}`.replace(/\s+/g, " ").trim();
  if (f.verdict === "CALLBACK_VERIFY") return `Confirm the change for ${f.vendor} by phone before ${f.amountAtRisk} is paid. ${call ? `${call}${not}.` : "Escalate to the contracting officer."} ${first}`.replace(/\s+/g, " ").trim();
  return `The checks found nothing against this change for ${f.vendor}${f.callbackAlreadyConfirmed ? ", and an earlier call-back to an independent number confirmed it" : ""}.`;
}

