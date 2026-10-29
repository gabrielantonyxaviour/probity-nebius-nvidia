// Text layer of a PDF: every text run with its position, size and fill colour (from the pdf.js operator list).
// Detection of what a person cannot see lives in hidden.ts.
import { extractTextItems, getDocumentProxy, getResolvedPDFJS } from "unpdf";

export interface RunItem {
  page: number; // 0-based
  str: string;
  x: number; // PDF points, origin bottom-left
  y: number;
  width: number;
  fontSize: number;
  fill: string | null; // "#rrggbb" when the operator list could be matched to this run
  renderMode: number | null; // 3 and 7 paint nothing
}

export interface PageText {
  width: number;
  height: number;
  items: RunItem[];
}

export class PdfError extends Error {
  constructor(message: string, readonly code: "unreadable_pdf" | "too_slow") {
    super(message);
  }
}

type OpText = { text: string; fill: string | null; mode: number };
const squash = (s: string) => s.replace(/\s+/g, "");

/** Walks the operator list once, recording the fill colour and render mode in force at every text-showing operator. */
async function operatorTexts(page: { getOperatorList: () => Promise<{ fnArray: number[]; argsArray: unknown[] }> }): Promise<OpText[]> {
  const pdfjs = await getResolvedPDFJS();
  const OPS = pdfjs.OPS as Record<string, number>;
  const { fnArray, argsArray } = await page.getOperatorList();
  const out: OpText[] = [];
  let fill: string | null = "#000000";
  let mode = 0;
  const stack: Array<{ fill: string | null; mode: number }> = [];
  const glyphsToText = (arg: unknown): string => {
    const list = Array.isArray(arg) ? arg : [];
    return list.map((g) => (g && typeof g === "object" && "unicode" in g ? String((g as { unicode: unknown }).unicode ?? "") : "")).join("");
  };
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i]!;
    const args = argsArray[i] as unknown[] | null;
    if (fn === OPS.save) stack.push({ fill, mode });
    else if (fn === OPS.restore) {
      const s = stack.pop();
      if (s) ({ fill, mode } = s);
    } else if (fn === OPS.setFillRGBColor) fill = typeof args?.[0] === "string" ? (args[0] as string).toLowerCase() : fill;
    else if (fn === OPS.setFillGray && typeof args?.[0] === "number") {
      const v = Math.round(Math.max(0, Math.min(1, args[0] as number)) * 255).toString(16).padStart(2, "0");
      fill = `#${v}${v}${v}`;
    } else if (fn === OPS.setTextRenderingMode && typeof args?.[0] === "number") mode = args[0] as number;
    else if (fn === OPS.showText || fn === OPS.showSpacedText || fn === OPS.nextLineShowText || fn === OPS.nextLineSetSpacingShowText) {
      const glyphArg = fn === OPS.nextLineSetSpacingShowText ? args?.[2] : args?.[0];
      out.push({ text: glyphsToText(glyphArg), fill, mode });
    }
  }
  return out;
}

export async function extractPages(bytes: Uint8Array): Promise<PageText[]> {
  try {
    const { items } = await extractTextItems(bytes.slice());
    const doc = await getDocumentProxy(bytes.slice());
    const pages: PageText[] = [];
    for (let p = 0; p < items.length; p++) {
      const page = await doc.getPage(p + 1);
      const [x0, y0, x1, y1] = page.view as [number, number, number, number];
      const ops = await operatorTexts(page as never);
      let cursor = 0;
      const runs: RunItem[] = [];
      for (const it of items[p]!) {
        if (it.str === "") continue;
        let hit: OpText | null = null;
        for (let k = cursor; k < Math.min(ops.length, cursor + 6); k++) {
          if (squash(ops[k]!.text) === squash(it.str)) {
            hit = ops[k]!;
            cursor = k + 1;
            break;
          }
        }
        runs.push({ page: p, str: it.str, x: it.x, y: it.y, width: it.width, fontSize: it.fontSize, fill: hit?.fill ?? null, renderMode: hit?.mode ?? null });
      }
      pages.push({ width: x1 - x0, height: y1 - y0, items: runs });
    }
    return pages;
  } catch (e) {
    if (e instanceof PdfError) throw e;
    throw new PdfError("The PDF could not be read", "unreadable_pdf");
  }
}
