import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzePdf } from "../src/pdf";

const require = createRequire(import.meta.url);
const wasm = new Uint8Array(fs.readFileSync(require.resolve("@hyzyla/pdfium/pdfium.wasm")));
const FIXTURES = path.resolve(__dirname, "../../fixtures/requests");
const analyze = (id: string) => {
  const stored: Array<{ i: number; bytes: number }> = [];
  return analyzePdf(new Uint8Array(fs.readFileSync(path.join(FIXTURES, id, "letter.pdf"))), {
    wasm,
    storePage: async (i, png) => (stored.push({ i, bytes: png.length }), `pages/t/${i + 1}.png`),
  }).then((a) => ({ a, stored }));
};

describe("pdf detectors", () => {
  it("finds the three hidden lines in the hidden-line letter as white on white", async () => {
    const { a } = await analyze("BCR-2026-0407");
    expect(a.hidden).toHaveLength(3);
    expect(a.hidden.every((h) => h.why === "white_on_white")).toBe(true);
    expect(a.hidden.map((h) => h.text).join(" ")).toMatch(/AI REVIEWER/);
    expect(a.hidden[0]!.detail).toMatch(/#ffffff on #ffffff/);
    expect(a.hidden[0]!.bbox).not.toBeNull();
    expect(a.scanned).toBe(false);
  });
  it.each(["BCR-2026-0412", "BCR-2026-0398"])("finds nothing hidden in the clean letter %s, and renders its page", async (id) => {
    const { a, stored } = await analyze(id);
    expect(a.hidden).toEqual([]);
    expect(a.lines.length).toBeGreaterThan(10);
    expect(a.pageKeys).toEqual(["pages/t/1.png"]);
    expect(stored[0]!.bytes).toBeGreaterThan(5_000);
  });
  it("rejects a file that is not a PDF", async () => {
    await expect(analyzePdf(new TextEncoder().encode("hello world, not a pdf"), { wasm, storePage: async () => "k" })).rejects.toThrow(/not a PDF/);
  });
});
