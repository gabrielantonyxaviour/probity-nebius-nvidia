// Lookups the engine makes in the payer's own records (read-only, D1). They turn into Evidence the gate can rely on:
// an account already on another vendor, something already rejected, a call-back already on record, a phone changed lately.
import type { Evidence } from "@probity/shared";
import { fact } from "../evidence/types";
import type { Env } from "../env";
import { formatPhone, phonesIn } from "../policy/normalise";
import { LABEL } from "../policy/types";
import type { Scratch } from "./types";

const DAY = 86_400_000;
const date = (iso: string) => iso.slice(0, 10);
const key10 = (p: string) => {
  const d = p.replace(/\D/g, "");
  return d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
};

export async function ledgerEvidence(env: Pick<Env, "DB">, s: Scratch): Promise<Evidence[]> {
  const now = new Date().toISOString();
  const out: Evidence[] = [];
  const f = (field: Evidence["field"], label: string, value: string) => out.push(fact("vendor_master", { field, label, value }, now, false));
  const { request } = s;
  const received = Date.parse(request.receivedAt);
  const letterKeys = new Set(s.letterPhones.map(key10));

  if (s.textAccount) {
    const { hash, last4 } = s.textAccount;
    const used = await env.DB.prepare(
      "SELECT a.vendor_id, a.status, a.changed_at, v.legal_name FROM vendor_bank_accounts a JOIN vendors v ON v.vendor_id = a.vendor_id WHERE a.account_hash = ?1 AND v.org_id = (SELECT org_id FROM vendors WHERE vendor_id = ?2)", // only this company's vendors: never another company's
    ).bind(hash, request.vendorId).all<{ vendor_id: string; status: string; changed_at: string; legal_name: string | null }>();
    for (const u of used.results) {
      if (u.vendor_id === request.vendorId) continue;
      f("bank_account", LABEL.accountOnOtherVendor, `••••${last4} is ${u.status} on ${u.vendor_id}${u.legal_name ? ` (${u.legal_name})` : ""} since ${date(u.changed_at)}`);
    }
    const bad = await env.DB.prepare("SELECT h.request_id, h.claimed_name, h.received_at FROM bank_change_history h JOIN vendors v ON v.vendor_id = h.vendor_id AND v.org_id = (SELECT org_id FROM vendors WHERE vendor_id = ?2) WHERE h.new_account_hash = ?1 AND h.status = 'rejected' LIMIT 1").bind(hash, request.vendorId).first<{ request_id: string; claimed_name: string; received_at: string }>();
    if (bad) f("bank_account", LABEL.knownBad, `account ••••${last4} was in request ${bad.request_id} (${bad.claimed_name}), rejected on ${date(bad.received_at)}`);
  }

  if (s.letterPhones.length) {
    const rej = await env.DB.prepare("SELECT h.request_id, h.claimed_name, h.letter_phones, h.received_at FROM bank_change_history h JOIN vendors v ON v.vendor_id = h.vendor_id AND v.org_id = (SELECT org_id FROM vendors WHERE vendor_id = ?1) WHERE h.status = 'rejected' AND h.letter_phones IS NOT NULL").bind(request.vendorId).all<{ request_id: string; claimed_name: string; letter_phones: string; received_at: string }>();
    const hit = rej.results.find((r) => r.letter_phones.split(/[,;\s]+/).some((p) => !!p && letterKeys.has(key10(p))));
    if (hit) f("phone", LABEL.knownBad, `a phone number in this letter was in request ${hit.request_id} (${hit.claimed_name}), rejected on ${date(hit.received_at)}`);
  }

  const log = await env.DB.prepare(
    "SELECT phone_e164, phone_source, called_at, called_by FROM vendor_contact_log WHERE request_id = ?1 AND purpose = 'bank_change_callback' AND outcome = 'confirmed' AND phone_source IN ('edgar_registrant','vendor_master_pre_window') ORDER BY called_at DESC",
  ).bind(request.requestId).all<{ phone_e164: string; phone_source: string; called_at: string; called_by: string }>();
  for (const l of log.results) {
    const shown = formatPhone(l.phone_e164) ?? l.phone_e164;
    if (Date.parse(l.called_at) <= received || letterKeys.has(key10(l.phone_e164))) continue;
    f("other", LABEL.callbackConfirmed, `confirmed by phone on ${shown} (${l.phone_source === "edgar_registrant" ? "SEC registrant number" : "number on file before the request"}) on ${date(l.called_at)} by ${l.called_by}`);
    break;
  }

  const cur = await env.DB.prepare("SELECT value, valid_from, changed_via FROM vendor_contacts WHERE vendor_id = ?1 AND kind = 'phone' AND valid_to IS NULL ORDER BY valid_from DESC LIMIT 1").bind(request.vendorId).first<{ value: string; valid_from: string; changed_via: string }>();
  if (cur && Date.parse(cur.valid_from) > received - 30 * DAY && Date.parse(cur.valid_from) <= received) {
    const days = Math.round((received - Date.parse(cur.valid_from)) / DAY);
    f("phone", LABEL.phoneRecent, `${formatPhone(cur.value) ?? cur.value}, changed ${date(cur.valid_from)} (${days} days before the request) via ${cur.changed_via}`);
    const before = await env.DB.prepare("SELECT value FROM vendor_contacts WHERE vendor_id = ?1 AND kind = 'phone' AND valid_to IS NOT NULL AND valid_from <= ?2 ORDER BY valid_to DESC LIMIT 1").bind(request.vendorId, new Date(received - 30 * DAY).toISOString()).first<{ value: string }>();
    if (before && phonesIn(before.value)[0]) f("phone", LABEL.phoneBefore, formatPhone(before.value) ?? before.value);
  }
  return out;
}
