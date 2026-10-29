// The rules. Each function looks at one concern and returns reasons; none of them calls a model.
// Hold reasons stop the change. Callback reasons mean "confirm by phone first". Info reasons never block.
import type { Evidence, Reason } from "@probity/shared";
import { addressesMatch, digits, domainOfAddress, lookalikeOf, nameNorm, nameOverlap, registrable, sameName, validAba } from "./normalise";
import { LABEL, type GateInput } from "./types";

const claim = (i: GateInput, field: string) => i.letter.claims.filter((c) => c.field === field);
const evOf = (i: GateInput, pred: (e: Evidence) => boolean) => i.evidence.filter(pred);
const ids = (es: Evidence[]) => es.map((e) => e.id);
const hold = (code: string, text: string, evidenceIds: string[] = []): Reason => ({ code, severity: "hold", text, evidenceIds });
const callback = (code: string, text: string, evidenceIds: string[] = []): Reason => ({ code, severity: "callback", text, evidenceIds });
const info = (code: string, text: string, evidenceIds: string[] = []): Reason => ({ code, severity: "info", text, evidenceIds });
const q = (s: string) => s.replace(/[.\s]+$/, "");
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function claimedNames(i: GateInput): string[] {
  return claim(i, "legal_name").map((c) => c.value).filter(Boolean);
}
export function accountHolder(i: GateInput): string | null {
  const c = claim(i, "other").find((x) => /^account (holder|name)\s*:/i.test(x.value));
  return c ? c.value.replace(/^account (holder|name)\s*:\s*/i, "").trim() : null;
}
export const senderDomains = (i: GateInput): string[] =>
  [domainOfAddress(i.request.email.from), i.request.email.replyTo ? domainOfAddress(i.request.email.replyTo) : null].filter((d): d is string => !!d);

export function domainReasons(i: GateInput): Reason[] {
  const dEv = evOf(i, (e) => e.field === "domain" && e.source === "vendor_master");
  const onFile = [...new Set([i.request.vendorOnFile.domain, ...dEv.map((e) => e.value)].filter((d): d is string => !!d).map((d) => d.toLowerCase()))];
  if (onFile.length === 0) return [callback("C2", `No e-mail domain is on file for ${i.request.vendorName}, so the sender could not be checked.`)];
  const reg = onFile.map(registrable);
  const bad = [...new Set(senderDomains(i))].find((d) => !reg.includes(registrable(d)));
  if (!bad) return [];
  const imitates = lookalikeOf(bad, onFile);
  return [hold("H1", `The e-mail came from ${bad}, which is not a domain on file for ${i.request.vendorName} (on file: ${onFile.join(", ")})${imitates ? `; it looks like a copy of ${imitates}` : ""}.`, ids(dEv))];
}

export function entityReasons(i: GateInput): Reason[] {
  const vendor = i.request.vendorName;
  const names = claimedNames(i);
  const holder = accountHolder(i);
  const out: Reason[] = [];
  const ex = i.examiner?.entity;
  const exEv = ex?.evidenceIds ?? [];
  const mismatched = names.filter((n) => !sameName(n, vendor));
  if (mismatched.length) {
    const n = mismatched[0]!;
    if (ex?.verdict === "same") out.push(info("I1", `The letter uses the name ${n}; the registries show it is the same company as ${vendor}.`, exEv));
    else if (ex?.verdict === "different" || ex?.verdict === "ambiguous" || (!ex && nameOverlap(n, vendor) < 0.5))
      out.push(hold(ex?.verdict === "ambiguous" ? "H5" : "H2", ex?.verdict === "ambiguous" ? `It is not clear which vendor this request is for (${n} or ${vendor}). Do not guess.` : `The letter is written for ${n}, which is not ${vendor}, the vendor of record.`, exEv));
    else out.push(callback("C3", `The letter uses the name ${n}, a related company rather than ${vendor}; confirm they are the same payee.`, exEv));
  } else if (names.length === 0) out.push(callback("C3", "The letter does not name the company asking for the change."));
  if (holder && !sameName(holder, vendor) && !names.some((n) => sameName(n, holder))) {
    out.push(nameOverlap(holder, vendor) < 0.5 ? hold("H6", `The new account is in the name of ${holder}, not ${vendor}.`) : callback("C4", `The new account name (${holder}) differs from ${vendor}; confirm it is the same payee.`));
  }
  if (ex?.verdict === "ambiguous" && !out.some((r) => r.code === "H5")) out.push(hold("H5", `It is not clear which vendor this request is for. Do not guess.`, exEv));
  return out;
}

export function addressReasons(i: GateInput): Reason[] {
  const claimed = claim(i, "remit_address")[0]?.value;
  const onFile = i.request.vendorOnFile.remitAddress;
  if (!claimed) return i.request.kind === "remit_change" ? [callback("C5", "The letter asks for a new remit address but does not give one.")] : [];
  if (addressesMatch(claimed, onFile)) return [];
  const ex = i.examiner?.address;
  const exEv = ex?.evidenceIds ?? [];
  if (ex?.verdict === "unchanged") return [];
  if (ex?.verdict === "other_entity") return [hold("H3", `The new remit address (${claimed}) belongs to a different company, not ${i.request.vendorName}.`, exEv)];
  if (ex?.verdict === "on_file") return [info("I2", `The new remit address (${claimed}) matches a registry address for ${i.request.vendorName}.`, exEv)];
  if (ex?.verdict === "related_entity") return [callback("C5", `The new remit address (${claimed}) belongs to a related company; confirm it is intended.`, exEv)];
  return [callback("C5", `The new remit address (${claimed}) matches no address on file or in the registries.`, exEv)];
}

export function accountReasons(i: GateInput): Reason[] {
  const out: Reason[] = [];
  const other = evOf(i, (e) => e.field === "bank_account" && e.label === LABEL.accountOnOtherVendor);
  if (other.length) out.push(hold("H4", `The requested account is already on another vendor: ${other[0]!.value}.`, ids(other)));
  const bad = evOf(i, (e) => e.label === LABEL.knownBad);
  if (bad.length) out.push(hold("H7", `The request matches something already rejected: ${bad[0]!.value}.`, ids(bad)));
  const routing = claim(i, "routing_number")[0]?.value;
  if (routing && !validAba(routing)) out.push(hold("H8", `Routing number ${digits(routing)} is not a valid bank routing number.`));
  if (i.readingsDisagree.length)
    out.push(hold("H9", `The text of the letter and the picture of the page disagree on the ${i.readingsDisagree.join(" and ")}. A person must compare the letter itself.`));
  return out;
}

/** Hidden or flagged text. Flagged text in the request is a hold; text a person cannot see but nothing flagged is a call-back. */
export function textReasons(i: GateInput): Reason[] {
  const out: Reason[] = [];
  const flags = i.screen.flags.filter((f) => f.source !== "web");
  const web = i.screen.flags.filter((f) => f.source === "web");
  // A hidden line counts as flagged when either text contains the other's opening words: the screen
  // and the PDF reader can split the same sentence differently.
  const head = (t: string) => nameNorm(t).slice(0, 40);
  const overlaps = (a: string, b: string) => nameNorm(a).includes(head(b)) || nameNorm(b).includes(head(a));
  const hiddenFlagged = i.letter.hidden.filter((h) => flags.some((f) => overlaps(f.text, h.text))).length;
  const onPage = flags.filter((f) => f.source === "letter").length - hiddenFlagged;
  const inMail = flags.filter((f) => f.source === "email").length;
  const parts = [
    hiddenFlagged ? `${plural(hiddenFlagged, "line", "lines")} hidden in the PDF where a person can't see ${hiddenFlagged === 1 ? "it" : "them"}` : null,
    onPage > 0 ? `${plural(onPage, "line", "lines")} in plain sight on the page` : null,
    inMail ? `${plural(inMail, "passage", "passages")} in the e-mail` : null,
  ].filter(Boolean);
  if (flags.length) out.push(hold("H10", `The request tries to instruct an automated reviewer: ${parts.join(", ")}. Probity treated it as evidence and ignored it.`));
  if (web.length) out.push(info("I4", `${plural(web.length, "web result", "web results")} found during the check contained text addressed to a reviewer; it was ignored.`));
  const unflagged = i.letter.hidden.filter((h) => !flags.some((f) => overlaps(f.text, h.text)));
  if (unflagged.length) out.push(callback("C6", `${plural(unflagged.length, "line", "lines")} in the PDF cannot be seen on the printed page; check the letter itself.`));
  return out;
}

/** Disguised text: characters a person cannot see, look-alike letters, encoded blobs. Disguise alone is a call-back; flagged text is held by textReasons. */
export function disguiseReasons(i: GateInput): Reason[] {
  const f = i.findings;
  if (!f) return [];
  const out: Reason[] = [];
  if (f.bidi > 0) out.push(hold("H11", `The text uses ${plural(f.bidi, "direction-control character", "direction-control characters")} that reorder what is shown on screen. Someone disguised it.`));
  if (f.zeroWidth > 0) out.push(callback("C11", `The text has ${plural(f.zeroWidth, "invisible character", "invisible characters")} inside words, which is how filters are slipped past. Read the letter itself.`));
  if (f.lookalikes.length) out.push(callback("C12", `${plural(f.lookalikes.length, "word", "words")} mix letters from different alphabets (for example "${f.lookalikes[0]}"), a disguise for text. Read the letter itself.`));
  if (f.encoded > 0) out.push(callback("C13", `${plural(f.encoded, "passage", "passages")} of encoded text were found and decoded; a payment request has no reason to hide text. Read the letter itself.`));
  return out;
}

export function conductReasons(i: GateInput): Reason[] {
  const out: Reason[] = [];
  const avoid = i.pressure.find((p) => p.kind === "avoid_verification" || p.kind === "secrecy");
  if (avoid) out.push(callback("C7", `The letter discourages checking: "${q(avoid.quote)}". Treat that as a warning sign.`));
  const rush = i.pressure.find((p) => p.kind === "urgency");
  if (rush) out.push(info("I3", `The letter pushes for speed: "${q(rush.quote)}".`));
  const recentPhone = i.evidence.find((e) => e.label === LABEL.phoneRecent);
  if (recentPhone) out.push(callback("C10", `The vendor's phone on file was changed shortly before this request (${recentPhone.value}), so it is not used for the call-back.`, [recentPhone.id]));
  const { spf, dkim } = i.request.email;
  const failed = [spf && spf !== "pass" ? `SPF ${spf}` : null, dkim && dkim !== "pass" ? `DKIM ${dkim}` : null].filter(Boolean);
  if (failed.length) out.push(callback("C8", `The e-mail did not pass sender authentication (${failed.join(", ")}).`));
  return out;
}
