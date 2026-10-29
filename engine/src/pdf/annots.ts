// Text a PDF carries that is not in its page text: annotations (sticky notes, comments), form-field values and document metadata.
// A person reading the page does not see most of it, but a program that reads "the whole PDF" does.
import { getDocumentProxy } from "unpdf";

export interface ExtraText {
  page: number; // 0-based; -1 for document metadata
  text: string;
  /** shown to the clerk when it is reported: "PDF annotation", "PDF form field", "PDF metadata (Subject)" */
  where: string;
  /** form fields and free-text boxes are drawn on the page, so they are part of the letter; the rest is hidden from a reader */
  visible: boolean;
  /** metadata is only reported when something flags it */
  soft: boolean;
  bbox: [number, number, number, number] | null;
}

type Annot = {
  subtype?: string;
  contents?: string;
  contentsObj?: { str?: string };
  title?: string;
  fieldValue?: string | string[] | null;
  fieldName?: string;
  alternativeText?: string;
  annotationFlags?: number;
  rect?: number[];
  hidden?: boolean;
};

const clip = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 600);
const HIDDEN = 2; // annotation flag bits: Hidden
const NO_VIEW = 32;

export async function extractExtras(bytes: Uint8Array, maxPages = 6): Promise<ExtraText[]> {
  const doc = await getDocumentProxy(bytes.slice());
  const out: ExtraText[] = [];
  for (let p = 0; p < Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p + 1);
    const height = (page.view as number[])[3]! - (page.view as number[])[1]!;
    for (const a of (await page.getAnnotations()) as Annot[]) {
      const rect = a.rect && a.rect.length === 4 ? a.rect : null;
      const bbox: ExtraText["bbox"] = rect ? [rect[0]!, height - rect[3]!, rect[2]!, height - rect[1]!] : null;
      const flags = a.annotationFlags ?? 0;
      const tiny = rect ? Math.abs(rect[2]! - rect[0]!) < 2 || Math.abs(rect[3]! - rect[1]!) < 2 : false;
      const drawn = !(flags & HIDDEN) && !(flags & NO_VIEW) && !tiny && !a.hidden;
      if (a.fieldValue !== undefined && a.fieldValue !== null && a.fieldValue !== "") {
        const v = Array.isArray(a.fieldValue) ? a.fieldValue.join(", ") : String(a.fieldValue);
        if (clip(v)) out.push({ page: p, text: clip(a.fieldName ? `${a.fieldName}: ${v}` : v), where: "PDF form field", visible: drawn, soft: false, bbox });
      }
      const note = clip(a.contentsObj?.str ?? a.contents ?? "");
      if (note) out.push({ page: p, text: note, where: "PDF annotation", visible: a.subtype === "FreeText" && drawn, soft: false, bbox });
      const alt = clip(a.alternativeText ?? "");
      if (alt) out.push({ page: p, text: alt, where: "PDF annotation", visible: false, soft: false, bbox });
    }
  }
  try {
    const meta = await doc.getMetadata();
    const info = (meta.info ?? {}) as Record<string, unknown>;
    for (const k of ["Title", "Subject", "Keywords", "Author"]) {
      const v = typeof info[k] === "string" ? clip(info[k] as string) : "";
      if (v.length >= 4) out.push({ page: -1, text: v, where: `PDF metadata (${k})`, visible: false, soft: true, bbox: null });
    }
    const custom = info.Custom as Record<string, unknown> | Map<string, unknown> | undefined;
    const entries = custom instanceof Map ? [...custom.entries()] : custom ? Object.entries(custom) : [];
    for (const [k, v] of entries) if (typeof v === "string" && clip(v).length >= 4) out.push({ page: -1, text: clip(v), where: `PDF metadata (${k})`, visible: false, soft: true, bbox: null });
  } catch {
    /* no metadata */
  }
  return out;
}
