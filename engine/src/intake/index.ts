// Intake module (Sonnet A): turns an incoming vendor e-mail (from Gmail or Outlook via B's webhook) into a request and starts its check.
import type { Env } from "../env";
import { parseEml } from "../check/eml";
import { admit, giveBack, startRun } from "../check/start";
import { matchVendor } from "../check/vendors";
import { amountAtRisk } from "../check/exposure";
import { sniffImage } from "../pdf/image";
import { domainOfAddress } from "../policy/normalise";

export type IncomingEmail = {
  orgId: string;
  source: "gmail" | "outlook";
  messageId: string;
  from: string;
  replyTo: string | null;
  subject: string;
  receivedAt: string;
  text: string;
  headers: Record<string, string>;
  attachments: { filename: string; contentType: string; bytes: ArrayBuffer }[];
};

export type IntakeResult = {
  status: "started" | "unchecked" | "duplicate";
  requestId: string;
  runId: string | null;
  /** plain words for the inbox when the request was not checked */
  note: string | null;
};

const MAX_LETTER = 10 * 1024 * 1024;
const MAX_BODY = 20_000;

const isPdf = (a: IncomingEmail["attachments"][number]) => /pdf/i.test(a.contentType) || /\.pdf$/i.test(a.filename);
const isImage = (a: IncomingEmail["attachments"][number]) => /^image\/(png|jpe?g)/i.test(a.contentType) || /\.(png|jpe?g)$/i.test(a.filename);

/** The first PDF attachment, else the first picture, else nothing (the e-mail body is then the letter). */
export function pickLetter(atts: IncomingEmail["attachments"]) {
  const ok = atts.filter((a) => a.bytes.byteLength > 0 && a.bytes.byteLength <= MAX_LETTER);
  const pdf = ok.find((a) => isPdf(a) && new TextDecoder().decode(new Uint8Array(a.bytes, 0, 5)) === "%PDF-");
  if (pdf) return { kind: "pdf" as const, ext: "pdf", type: "application/pdf", bytes: new Uint8Array(pdf.bytes), filename: pdf.filename };
  for (const a of ok.filter(isImage)) {
    const info = sniffImage(new Uint8Array(a.bytes));
    if (info) return { kind: "image" as const, ext: info.ext, type: info.mime, bytes: new Uint8Array(a.bytes), filename: a.filename };
  }
  return null;
}

const header = (h: Record<string, string>, name: string) => Object.entries(h).find(([k]) => k.toLowerCase() === name)?.[1] ?? null;

/** A header block plus the body, in the shape the pipeline's e-mail reader and the web UI already know. */
export function emlFor(m: IncomingEmail): string {
  const auth = header(m.headers, "authentication-results");
  return [`From: ${m.from}`, m.replyTo ? `Reply-To: ${m.replyTo}` : null, `Subject: ${m.subject}`, `Date: ${m.receivedAt}`, auth ? `Authentication-Results: ${auth}` : null, "", m.text.slice(0, MAX_BODY)].filter((l) => l !== null).join("\n");
}

const stem = (f: string) => f.replace(/\.[a-z0-9]+$/i, "").replace(/[_\-.]+/g, " ");
const displayName = (from: string) => /^\s*"?([^"<]+?)"?\s*</.exec(from)?.[1] ?? "";
const kindOf = (m: IncomingEmail): "bank_change" | "remit_change" => (/remit/i.test(`${m.subject} ${m.text}`) && !/bank|account|ach|routing|wire/i.test(`${m.subject} ${m.text}`) ? "remit_change" : "bank_change");

async function unmatchedVendor(env: Env, orgId: string): Promise<string> {
  const id = `unmatched_${orgId}`;
  await env.DB.prepare(
    "INSERT OR IGNORE INTO vendors (vendor_id, legal_name, legal_name_norm, is_fictional, status, created_at, org_id) VALUES (?1, 'Unknown sender', 'UNKNOWN SENDER', 0, 'unknown', ?2, ?3)",
  ).bind(id, new Date().toISOString(), orgId).run();
  return id;
}

/**
 * One incoming e-mail becomes one request, once (idempotent by message id), and, when the company has checks left, its check starts.
 * No attachment: the e-mail body is the letter. No matching vendor: the request is kept but not checked, and says why.
 */
export async function intake(env: Env, m: IncomingEmail): Promise<IntakeResult> {
  const existing = await env.DB.prepare("SELECT id, latest_run_id, note FROM requests WHERE org_id = ?1 AND message_id = ?2").bind(m.orgId, m.messageId).first<{ id: string; latest_run_id: string | null; note: string | null }>();
  if (existing) return { status: "duplicate", requestId: existing.id, runId: existing.latest_run_id, note: existing.note };

  const requestId = `${m.source === "gmail" ? "GM" : "OL"}-${m.receivedAt.slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
  const letter = pickLetter(m.attachments);
  const base = `orgs/${m.orgId}/mail/${requestId}`;
  const letterKey = `${base}/letter.${letter?.ext ?? "txt"}`;
  const emlKey = `${base}/headers.eml`;
  const eml = emlFor(m);
  const mail = parseEml(eml);

  const found = await matchVendor(env, m.orgId, { from: m.from, names: [displayName(m.from), m.subject, ...(letter ? [stem(letter.filename)] : [])] });
  const matched = "match" in found ? found.match : null;
  let note: string | null = null;
  if ("none" in found) note = `No vendor of record matches this e-mail (sender ${domainOfAddress(m.from) ?? "unknown"}). Add the vendor to your vendor list, then check it.`;
  if ("ambiguous" in found) note = `This e-mail could be from more than one vendor (${found.ambiguous.slice(0, 3).join(", ")}). It was not checked; do not guess.`;

  let admitted = false;
  if (matched) {
    const a = await admit(env, `intake:${requestId}`, m.orgId);
    if (a.ok) admitted = true;
    else note = a.code === "plan_limit" ? "This company has used its checks for the month. Upgrade to check this request." : "Live checks are switched off for now, so this request was not checked.";
  }

  await env.FILES.put(letterKey, letter ? letter.bytes : new TextEncoder().encode(m.text.slice(0, MAX_BODY)), { httpMetadata: { contentType: letter?.type ?? "text/plain" } });
  await env.FILES.put(emlKey, eml, { httpMetadata: { contentType: "text/plain" } });
  const vendorId = matched?.vendorId ?? (await unmatchedVendor(env, m.orgId));
  const amount = matched ? await amountAtRisk(env, m.orgId, vendorId) : { cents: 0, nextRunAt: null };
  try {
    await env.DB.prepare(
      "INSERT INTO requests (id, vendor_id, kind, received_at, sender_email, amount_cents, next_run_at, status, synthetic, letter_key, eml_key, json, org_id, source, message_id, note) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'unchecked', 0, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
    )
      .bind(requestId, vendorId, kindOf(m), m.receivedAt, mail.sender, amount.cents, amount.nextRunAt, letterKey, emlKey, JSON.stringify({ channel: "email", email: { from: m.from, replyTo: m.replyTo, subject: m.subject, received: m.receivedAt, spf: mail.spf, dkim: mail.dkim }, letter: letter?.kind ?? "body" }), m.orgId, m.source, m.messageId, note)
      .run();
  } catch (e) {
    if (admitted) await giveBack(env, `intake:${requestId}`, m.orgId);
    // Two deliveries of the same message raced: the other one won.
    const again = await env.DB.prepare("SELECT id, latest_run_id, note FROM requests WHERE org_id = ?1 AND message_id = ?2").bind(m.orgId, m.messageId).first<{ id: string; latest_run_id: string | null; note: string | null }>();
    if (again) return { status: "duplicate", requestId: again.id, runId: again.latest_run_id, note: again.note };
    throw e;
  }
  if (!matched || !admitted) return { status: "unchecked", requestId, runId: null, note };

  const started = await startRun(env, `intake:${requestId}`, m.orgId, requestId, matched.legalName, true);
  if (!started.ok) {
    await giveBack(env, `intake:${requestId}`, m.orgId);
    note = "The check could not be started. Try it again from the inbox.";
    await env.DB.prepare("UPDATE requests SET note = ?2 WHERE id = ?1").bind(requestId, note).run();
    return { status: "unchecked", requestId, runId: null, note };
  }
  return { status: "started", requestId, runId: started.runId, note: null };
}
