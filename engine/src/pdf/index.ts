// One entry point for the `pdf` step: text layer, hidden-text detection, page images.
import type { HiddenText } from "@probity/shared";
import { extractPages, PdfError, type PageText } from "./extract";
import { buildLines, classify, hiddenFromLines, type LetterLine, type Verdict } from "./hidden";
import { encodePng } from "./png";
import { openRenderer, renderPages, type PdfiumWasm, type Raster } from "./render";

export { PdfError } from "./extract";
export type { LetterLine } from "./hidden";
export type { PdfiumWasm } from "./render";

export const MAX_PAGES = 6;
export const RENDER_SCALE = 1.5;
const PARSE_TIMEOUT_MS = 25_000;
/** Fewer visible characters than this in the whole file and the PDF is treated as a scan. */
const SCAN_CHARS = 40;

export interface PdfAnalysis {
  pageCount: number;
  pageSize: [number, number];
  lines: LetterLine[];
  hidden: HiddenText[];
  scanned: boolean;
  truncated: boolean;
  /** page index -> PNG bytes were handed to `storePage`; keys come back in order */
  pageKeys: string[];
}

export interface AnalyzeOptions {
  wasm: PdfiumWasm;
  /** Stores one page image and returns its file key. */
  storePage: (pageIndex: number, png: Uint8Array) => Promise<string>;
  maxPages?: number;
  scale?: number;
}

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<never>((_, rej) => setTimeout(() => rej(new PdfError("The PDF took too long to read", "too_slow")), ms))]);
}

export async function analyzePdf(bytes: Uint8Array, opts: AnalyzeOptions): Promise<PdfAnalysis> {
  if (bytes.length < 8 || String.fromCharCode(...bytes.subarray(0, 5)) !== "%PDF-") throw new PdfError("That file is not a PDF", "unreadable_pdf");
  const maxPages = opts.maxPages ?? MAX_PAGES;
  const pages: PageText[] = await withTimeout(extractPages(bytes), PARSE_TIMEOUT_MS);
  const visibleChars = pages.reduce((n, p) => n + p.items.reduce((m, it) => m + (it.fontSize >= 3 && it.fill !== "#ffffff" ? it.str.replace(/\s/g, "").length : 0), 0), 0);
  const scanned = visibleChars < SCAN_CHARS;

  const lines: LetterLine[] = [];
  const pageKeys: string[] = [];
  const lib = await openRenderer(opts.wasm);
  let total = pages.length;
  try {
    total = await renderPages(lib, bytes, { scale: opts.scale ?? RENDER_SCALE, maxPages }, async (i: number, raster: Raster) => {
      const page = pages[i];
      if (page) {
        const verdicts: Array<Verdict | null> = page.items.map((it) => classify(it, page, raster, scanned));
        lines.push(...buildLines(page, i, verdicts, 1));
      }
      const png = await encodePng(raster.width, raster.height, raster.rgba);
      pageKeys.push(await opts.storePage(i, png));
    });
  } catch (e) {
    if (e instanceof PdfError) throw e;
    throw new PdfError("The PDF could not be rendered", "unreadable_pdf");
  } finally {
    lib.destroy();
  }
  const first = pages[0];
  return {
    pageCount: Math.min(total, maxPages),
    pageSize: first ? [first.width, first.height] : [612, 792],
    lines,
    hidden: hiddenFromLines(lines),
    scanned,
    truncated: total > maxPages,
    pageKeys,
  };
}
