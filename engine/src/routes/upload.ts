// POST /api/checks/upload: a visitor's own letter (PDF, optionally the e-mail as .eml) and the vendor it is for.
import { Hono } from "hono";
import { z } from "zod";
import { admit, startRun } from "../check/start";
import { matchVendor } from "../check/vendors";
import { actor } from "./scope";
import { fail, type AppEnv } from "./util";
import { startFailure } from "./start";

const MAX_PDF = 10 * 1024 * 1024;
const MAX_EML = 512 * 1024;
const VendorName = z.string().trim().min(2).max(120);

/** From, Reply-To, Subject and the SPF/DKIM verdicts out of a raw e-mail header block. */
export function parseEml(text: string) {
  const head = text.replace(/\r\n/g, "\n").split(/\n\n/)[0]!.replace(/\n[ \t]+/g, " ");
  const h = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "im").exec(head)?.[1]?.trim() ?? null;
  const auth = (k: string) => new RegExp(`\\b${k}=([a-z]+)`, "i").exec(head)?.[1]?.toLowerCase() ?? null;
  const from = h("From") ?? "unknown";
  return { from, replyTo: h("Reply-To"), subject: h("Subject") ?? "(no subject)", spf: auth("spf"), dkim: auth("dkim"), sender: /<?([^<>\s"]+@[^<>\s"]+)>?\s*$/.exec(from)?.[1] ?? "unknown" };
}

export const uploadRoutes = new Hono<AppEnv>().post("/api/checks/upload", actor, async (c) => {
  const form = await c.req.parseBody().catch(() => null);
  const pdf = form?.pdf;
  const eml = form?.eml;
  const name = VendorName.safeParse(form?.vendorName);
  if (!(pdf instanceof File)) return fail(c, 400, "Attach the letter as a PDF in the field named pdf.", "bad_request");
  if (!name.success) return fail(c, 400, "Say which vendor the letter is for (2 to 120 characters).", "bad_request");
  if (pdf.size === 0 || pdf.size > MAX_PDF) return fail(c, 413, "The PDF must be larger than zero bytes and at most 10 MB.", "too_large");
  const bytes = new Uint8Array(await pdf.arrayBuffer());
  if (String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") return fail(c, 415, "That file is not a PDF.", "not_pdf");
  let emlText = "";
  if (eml instanceof File) {
    if (eml.size > MAX_EML) return fail(c, 413, "The e-mail file must be at most 512 KB.", "too_large");
    emlText = await eml.text();
  }

  const org = c.get("orgId");
  const m = await matchVendor(c.env, org, { from: "", names: [name.data] });
  if ("none" in m) return fail(c, 422, "No vendor of record matches that name. Check the spelling against your vendor list.", "unknown_vendor");
  if ("ambiguous" in m) return fail(c, 422, "More than one vendor matches that name. Use the full legal name.", "ambiguous_vendor");
  const vendor = { vendor_id: m.match.vendorId, legal_name: m.match.legalName };

  // Admission first, so a refused upload leaves nothing behind.
  const ok = await admit(c.env, c.get("sid"), org);
  if (!ok.ok) return startFailure(c, ok.code);

  const requestId = `UPL-${new Date().toISOString().slice(0, 10).replace(/-/g, "")}-${crypto.randomUUID().slice(0, 4).toUpperCase()}`;
  const letterKey = `orgs/${org}/uploads/${requestId}/letter.pdf`;
  const emlKey = emlText ? `orgs/${org}/uploads/${requestId}/headers.eml` : null;
  const mail = parseEml(emlText);
  const now = new Date().toISOString();
  const next = await c.env.DB.prepare("SELECT cutoff_at FROM payment_runs WHERE cutoff_at > ?1 AND status != 'released' ORDER BY cutoff_at LIMIT 1").bind(now).first<{ cutoff_at: string }>();
  const amount = await c.env.DB.prepare("SELECT COALESCE(SUM(amount_cents), 0) AS cents FROM ap_invoices WHERE vendor_id = ?1 AND status IN ('open','approved','scheduled')").bind(vendor.vendor_id).first<{ cents: number }>();

  await c.env.FILES.put(letterKey, bytes, { httpMetadata: { contentType: "application/pdf" } });
  if (emlKey) await c.env.FILES.put(emlKey, emlText, { httpMetadata: { contentType: "text/plain" } });
  await c.env.DB.prepare(
    "INSERT INTO requests (id, vendor_id, kind, received_at, sender_email, amount_cents, next_run_at, status, synthetic, letter_key, eml_key, json, org_id, source, session_id) VALUES (?1, ?2, 'bank_change', ?3, ?4, ?5, ?6, 'unchecked', 0, ?7, ?8, ?9, ?10, 'upload', ?11)",
  )
    .bind(requestId, vendor.vendor_id, now, mail.sender, amount?.cents ?? 0, next?.cutoff_at ?? null, letterKey, emlKey, JSON.stringify({ channel: emlText ? "email" : "upload", email: { from: mail.from, replyTo: mail.replyTo, subject: mail.subject, received: now, spf: mail.spf, dkim: mail.dkim } }), org, c.get("sid"))
    .run();

  const started = await startRun(c.env, c.get("sid"), org, requestId, vendor.legal_name, true);
  return started.ok ? c.json({ runId: started.runId, requestId }) : startFailure(c, started.code);
});
