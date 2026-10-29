// Step `pdf`: load the request, open the letter, find what a person cannot see, render the pages.
import type { Run } from "@probity/shared";
import { getRequest } from "../evidence";
import { analyzePdf, type PdfAnalysis } from "../pdf";
import { extractExtras } from "../pdf/annots";
import type { LetterLine } from "../pdf/hidden";
import { sniffImage } from "../pdf/image";
import { mergeFindings, noFindings, sanitize } from "./sanitize";
import { phonesIn } from "../policy/normalise";
import type { Ctx, Scratch, StageOut } from "./types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

async function pdfAnalysis(ctx: Ctx, bytes: Uint8Array): Promise<PdfAnalysis> {
  return analyzePdf(bytes, {
    wasm: ctx.wasm,
    storePage: async (i, png) => {
      const key = `pages/${ctx.runId}/${i + 1}.png`;
      await ctx.files.put(key, png, "image/png");
      return key;
    },
  });
}

/** A photo or screenshot: no text layer at all, so the vision model's reading is the only one. */
async function imageAnalysis(ctx: Ctx, bytes: Uint8Array): Promise<PdfAnalysis> {
  const info = sniffImage(bytes)!;
  const key = `pages/${ctx.runId}/1.${info.ext}`;
  await ctx.files.put(key, bytes, info.mime);
  return { pageCount: 1, pageSize: [info.width || 612, info.height || 792], lines: [], hidden: [], scanned: true, truncated: false, invisible: { zeroWidth: 0, bidi: 0 }, pageKeys: [key] };
}

/** No attachment: the e-mail's own text is the letter. Nothing can be hidden in plain text, and there is no page to look at. */
function bodyAnalysis(text: string): PdfAnalysis {
  const lines = text.split(/\r?\n/).map((t) => t.trim()).filter(Boolean).slice(0, 200).map((t, k) => ({ id: `p1.l${k + 1}`, page: 0, text: t.slice(0, 500), y: 792 - k * 12, fontSize: 11, hidden: null, bbox: [0, 0, 0, 0] as [number, number, number, number] }));
  return { pageCount: 1, pageSize: [612, 792], lines, hidden: [], scanned: false, truncated: false, invisible: { zeroWidth: 0, bidi: 0 }, pageKeys: [] };
}

export async function pdfStage(ctx: Ctx): Promise<StageOut> {
  const run = await ctx.store.get(ctx.runId);
  const req = await getRequest(ctx.env, run.requestId);
  const bytes = await ctx.files.get(req.letterKey);
  if (!bytes) throw new Error("The letter file for this request is missing.");
  const kind = req.letterKey.endsWith(".txt") ? "body" : sniffImage(bytes) ? "image" : "pdf";
  const a = kind === "body" ? bodyAnalysis(new TextDecoder().decode(bytes)) : kind === "image" ? await imageAnalysis(ctx, bytes) : await pdfAnalysis(ctx, bytes);
  // Extra text a PDF carries outside its page text: comments, form fields, metadata.
  const extras = kind === "pdf" ? await extractExtras(bytes).catch(() => []) : [];
  extras.forEach((e, k) => {
    const hidden = e.visible ? null : { why: "off_page" as const, detail: `${e.where}, not part of the page text` };
    a.lines.push({ id: `x${k + 1}`, page: Math.max(0, e.page), text: e.text, y: 0, fontSize: 11, hidden, bbox: e.bbox ?? [0, 0, 0, 0], ...(e.soft ? { soft: true } : {}) });
    if (hidden && !e.soft) a.hidden.push({ page: Math.max(0, e.page), text: e.text, why: "off_page", detail: hidden.detail, bbox: e.bbox });
  });
  // One cleaned text for everything downstream: normalised, no invisible characters, look-alike letters mapped to Latin.
  let findings = { ...noFindings(), zeroWidth: a.invisible.zeroWidth, bidi: a.invisible.bidi };
  const lines: LetterLine[] = a.lines.map((l) => {
    const c = sanitize(l.text);
    findings = mergeFindings(findings, c.findings);
    return { ...l, text: c.text };
  });
  a.lines = lines.filter((l) => l.text);
  for (const h of a.hidden) h.text = sanitize(h.text).text;

  const request = {
    requestId: req.requestId, vendorId: req.vendorId, vendorName: req.vendorOnFile.legalName || req.vendorName, kind: req.kind, senderEmail: req.senderEmail,
    amountAtRisk: req.amountAtRisk, nextRunAt: req.nextRunAt, email: req.email, vendorOnFile: req.vendorOnFile, receivedAt: req.receivedAt,
  };
  const scratch: Scratch = {
    request, emlText: req.emlText, letterKind: kind, findings, lines: a.lines, letterPhones: [...new Set(a.lines.flatMap((l) => phonesIn(l.text)))], withheld: [], claims: [], pressure: [],
    textAccount: null, readingsDisagree: [], examiner: null, pageKeys: a.pageKeys,
  };
  await ctx.store.update(ctx.runId, (r: Run) => {
    r.vendorName = request.vendorName;
    r.letter = { pageCount: a.pageCount, pageImages: a.pageKeys, pageSize: a.pageSize, claims: [], hidden: a.hidden, scanned: a.scanned };
  });
  const hidden = a.hidden.length ? `; ${plural(a.hidden.length, "line", "lines")} a person cannot see` : "";
  return { scratch, summary: `${plural(a.pageCount, "page", "pages")} read${a.scanned ? " (scanned, no text layer)" : ""}${hidden}${a.truncated ? "; only the first pages were used" : ""}` };
}
