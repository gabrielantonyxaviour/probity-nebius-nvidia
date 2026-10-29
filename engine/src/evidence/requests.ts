// Inbox rows and one request's detail, from D1 (+ the e-mail headers from R2).
import { InboxItem, type RequestDetail } from "@probity/shared";
import { z } from "zod";
import { loadVendor } from "./vendor-master";
import type { EvidenceEnv } from "./types";

type Row = {
  id: string; vendor_id: string; vendor_name: string | null; kind: string; received_at: string; sender_email: string; amount_cents: number; next_run_at: string | null;
  status: string; latest_run_id: string | null; outcome: string | null; swept_at: string | null; synthetic: number; letter_key: string; eml_key: string | null; json: string; verdict: string | null;
};

const Extra = z.object({ email: z.object({ from: z.string(), replyTo: z.string().nullable().optional(), subject: z.string(), received: z.string().optional(), spf: z.string().nullable().optional(), dkim: z.string().nullable().optional() }) }).passthrough();

const COLUMNS = `r.id, r.vendor_id, v.legal_name AS vendor_name, r.kind, r.received_at, r.sender_email, r.amount_cents, r.next_run_at, r.status, r.latest_run_id, r.outcome, r.swept_at, r.synthetic, r.letter_key, r.eml_key, r.json,
  CASE WHEN r.latest_run_id IS NULL THEN NULL ELSE (SELECT json_extract(u.json, '$.decision.finalVerdict') FROM runs u WHERE u.id = r.latest_run_id) END AS verdict`;

function toItem(r: Row): InboxItem {
  return InboxItem.parse({
    requestId: r.id, vendorId: r.vendor_id, vendorName: r.vendor_name ?? r.vendor_id, kind: r.kind, receivedAt: r.received_at, senderEmail: r.sender_email,
    amountAtRisk: { cents: r.amount_cents, currency: "USD" }, nextRunAt: r.next_run_at, status: r.status, verdict: r.verdict, outcome: r.outcome,
    runId: r.latest_run_id, sweptAt: r.swept_at, synthetic: r.synthetic === 1,
  });
}

/** Soonest payment run first, then the most recently received. */
export async function listInbox(env: Pick<EvidenceEnv, "DB">): Promise<InboxItem[]> {
  const res = await env.DB.prepare(`SELECT ${COLUMNS} FROM requests r LEFT JOIN vendors v ON v.vendor_id = r.vendor_id ORDER BY r.next_run_at ASC, r.received_at DESC`).all<Row>();
  return res.results.map(toItem);
}

export class RequestNotFoundError extends Error {
  constructor(public readonly requestId: string) {
    super(`request ${requestId} not found`);
  }
}

export async function getRequest(env: EvidenceEnv, requestId: string): Promise<RequestDetail & { emlText: string; letterKey: string }> {
  const r = await env.DB.prepare(`SELECT ${COLUMNS} FROM requests r LEFT JOIN vendors v ON v.vendor_id = r.vendor_id WHERE r.id = ?1`).bind(requestId).first<Row>();
  if (!r) throw new RequestNotFoundError(requestId);
  const extra = Extra.parse(JSON.parse(r.json));
  const vendor = await loadVendor(env, r.vendor_id);
  const emlText = r.eml_key ? ((await (await env.FILES.get(r.eml_key))?.text()) ?? "") : "";
  return {
    ...toItem(r),
    letterKey: r.letter_key,
    email: { from: extra.email.from, replyTo: extra.email.replyTo ?? null, subject: extra.email.subject, received: extra.email.received ?? r.received_at, spf: extra.email.spf ?? null, dkim: extra.email.dkim ?? null },
    vendorOnFile: { legalName: vendor?.legalName ?? r.vendor_name ?? r.vendor_id, remitAddress: vendor?.remitAddress ?? "", phone: vendor?.phone ?? null, domain: vendor?.domain ?? null, accountMasked: vendor?.accountMasked ?? "no active account" },
    emlText,
  };
}
