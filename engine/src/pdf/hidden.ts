// What a person cannot see: text in the colour of the page, glyphs too small to read, text outside the page, text
// drawn with an invisible render mode. Colour is judged against the rendered page, so white text on a dark band is fine.
import type { HiddenText } from "@probity/shared";
import type { PageText, RunItem } from "./extract";
import type { Raster } from "./render";

export type HiddenWhy = HiddenText["why"];
export interface Verdict {
  why: HiddenWhy;
  detail: string;
}

export interface LetterLine {
  id: string; // "p1.l7": page and line, both 1-based
  page: number; // 0-based
  text: string;
  y: number; // PDF points, origin bottom-left
  fontSize: number;
  hidden: Verdict | null;
  bbox: [number, number, number, number]; // top-left origin
  /** only reported to the clerk if the screen flags it (PDF metadata) */
  soft?: boolean;
}

const TINY_PT = 3;
const MIN_CONTRAST = 1.3;

const hexToRgb = (hex: string): [number, number, number] | null => {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  return m ? [parseInt(m[1]!.slice(0, 2), 16), parseInt(m[1]!.slice(2, 4), 16), parseInt(m[1]!.slice(4, 6), 16)] : null;
};
const lin = (c: number) => ((c /= 255) <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const luminance = (rgb: [number, number, number]) => 0.2126 * lin(rgb[0]) + 0.7152 * lin(rgb[1]) + 0.0722 * lin(rgb[2]);
export const contrastRatio = (a: [number, number, number], b: [number, number, number]) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x) as [number, number];
  return (hi + 0.05) / (lo + 0.05);
};
const toHex = (c: [number, number, number]) => `#${c.map((v) => v.toString(16).padStart(2, "0")).join("")}`;

/** Median colour of the pixels under a run. The median ignores the glyph strokes and finds the surface the text sits on. */
export function backgroundUnder(r: Raster | null, item: RunItem, pageHeight: number): [number, number, number] {
  if (!r) return [255, 255, 255];
  const pad = 1.5;
  const x0 = Math.max(0, Math.floor((item.x - pad) * r.scale));
  const x1 = Math.min(r.width, Math.ceil((item.x + Math.max(item.width, 1) + pad) * r.scale));
  const top = pageHeight - item.y - item.fontSize * 0.8;
  const y0 = Math.max(0, Math.floor((top - pad) * r.scale));
  const y1 = Math.min(r.height, Math.ceil((top + item.fontSize + pad) * r.scale));
  if (x1 <= x0 || y1 <= y0) return [255, 255, 255];
  const rs: number[] = [];
  const gs: number[] = [];
  const bs: number[] = [];
  const stepX = Math.max(1, Math.floor((x1 - x0) / 60));
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x += stepX) {
      const i = (y * r.width + x) * 4;
      rs.push(r.rgba[i]!);
      gs.push(r.rgba[i + 1]!);
      bs.push(r.rgba[i + 2]!);
    }
  }
  const med = (a: number[]) => a.sort((p, q) => p - q)[Math.floor(a.length / 2)]!;
  return [med(rs), med(gs), med(bs)];
}

export function classify(item: RunItem, page: PageText, raster: Raster | null, scannedDoc: boolean): Verdict | null {
  if (!item.str.trim()) return null;
  const pt = `${Math.round(item.fontSize * 10) / 10} pt`;
  const offPage = item.x > page.width + 1 || item.x + item.width < -1 || item.y < -item.fontSize || item.y > page.height + item.fontSize;
  if (offPage) return { why: "off_page", detail: `outside the page area, ${pt}` };

  const fillRgb = item.fill ? hexToRgb(item.fill) : null;
  const bg = backgroundUnder(raster, item, page.height);
  const lowContrast = fillRgb ? contrastRatio(fillRgb, bg) < MIN_CONTRAST : false;
  const tiny = item.fontSize < TINY_PT;
  if (lowContrast && fillRgb) return { why: "white_on_white", detail: `fill ${toHex(fillRgb)} on ${toHex(bg)}, ${pt}${tiny ? ", too small to read" : ""}` };
  if (tiny) return { why: "tiny_glyphs", detail: `${pt}, too small to read` };
  if ((item.renderMode === 3 || item.renderMode === 7) && !scannedDoc) return { why: "under_image", detail: "invisible text rendering mode" };
  return null;
}

/** Joins runs into lines. A hidden run never shares a line with a visible one, so each line has one verdict. */
export function buildLines(page: PageText, pageIndex: number, verdicts: Array<Verdict | null>, startNo: number): LetterLine[] {
  const lines: LetterLine[] = [];
  let cur: { items: RunItem[]; v: Verdict | null; y: number } | null = null;
  const flush = () => {
    if (!cur) return;
    const text = cur.items
      .map((it, i, arr) => {
        const prev = arr[i - 1];
        const gap = prev ? it.x - (prev.x + prev.width) : 0;
        const needSpace = prev && gap > 1.5 && !/\s$/.test(prev.str) && !/^\s/.test(it.str);
        return (needSpace ? " " : "") + it.str;
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim();
    if (text) {
      const fs = Math.max(...cur.items.map((i) => i.fontSize));
      const x0 = Math.min(...cur.items.map((i) => i.x));
      const x1 = Math.max(...cur.items.map((i) => i.x + i.width));
      lines.push({
        id: `p${pageIndex + 1}.l${startNo + lines.length}`,
        page: pageIndex,
        text,
        y: cur.y,
        fontSize: fs,
        hidden: cur.v,
        bbox: [x0, page.height - cur.y - fs * 0.8, x1, page.height - cur.y + fs * 0.2],
      });
    }
    cur = null;
  };
  page.items.forEach((it, idx) => {
    const v = verdicts[idx] ?? null;
    if (!it.str.trim() && !cur) return;
    const sameLine = cur && Math.abs(cur.y - it.y) <= Math.max(2, it.fontSize * 0.4) && (cur.v?.why ?? null) === (v?.why ?? null);
    if (!sameLine) {
      flush();
      if (!it.str.trim()) return;
      cur = { items: [], v, y: it.y };
    }
    cur!.items.push(it);
  });
  flush();
  return lines;
}

export function hiddenFromLines(lines: LetterLine[]): HiddenText[] {
  return lines
    .filter((l) => l.hidden)
    .map((l) => ({ page: l.page, text: l.text, why: l.hidden!.why, detail: l.hidden!.detail, bbox: l.bbox }));
}
