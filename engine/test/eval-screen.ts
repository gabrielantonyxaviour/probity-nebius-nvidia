// Developer tool: runs the injection screen (real Token Factory) over every labelled test letter and reports catch and false-alarm rates.
// Costs about $0.01. Usage: ../node_modules/.bin/tsx test/eval-screen.ts   (needs NEBIUS_API_KEY in .dev.vars)
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { decodedBlobs, mergeFindings, noFindings, sanitize } from "../src/check/sanitize";
import { screenSpans } from "../src/check/screenstage";
import { analyzePdf } from "../src/pdf";
import { extractExtras } from "../src/pdf/annots";
import { readPage } from "../src/check/readstage";
import type { Ctx } from "../src/check/types";

const require = createRequire(import.meta.url);
const wasm = new Uint8Array(fs.readFileSync(require.resolve("@hyzyla/pdfium/pdfium.wasm")));
const key = /NEBIUS_API_KEY=(.*)/.exec(fs.readFileSync(path.join(import.meta.dirname, "../.dev.vars"), "utf8"))![1]!;
const ctx = { env: { NEBIUS_API_KEY: key } } as unknown as Ctx;
const root = path.resolve(import.meta.dirname, "../../fixtures/testset");

type Row = { id: string; injection: boolean; flagged: boolean; findings: string; spans: number; why: string };
const rows: Row[] = [];
for (const dir of fs.readdirSync(root).sort()) {
  const pdfPath = path.join(root, dir, "letter.pdf");
  if (!fs.existsSync(pdfPath)) continue;
  const label = JSON.parse(fs.readFileSync(path.join(root, dir, "label.json"), "utf8")) as { injection: boolean; scan: boolean };
  const bytes = new Uint8Array(fs.readFileSync(pdfPath));
  const store: Record<string, Uint8Array> = {};
  const a = await analyzePdf(bytes, { wasm, storePage: async (i, png) => ((store[`p${i}`] = png), `p${i}`) });
  let findings = { ...noFindings(), zeroWidth: a.invisible.zeroWidth, bidi: a.invisible.bidi };
  const texts: string[] = [];
  const add = (t: string) => {
    const c = sanitize(t);
    findings = mergeFindings(findings, c.findings);
    if (c.text) texts.push(c.text);
    for (const d of decodedBlobs(c.text)) (findings.encoded++, texts.push(`Decoded from base64: ${sanitize(d).text}`));
  };
  a.lines.forEach((l) => add(l.text));
  (await extractExtras(bytes)).forEach((e) => add(e.text));
  if (a.scanned) {
    // a picture: the vision model reads it, then the lines are screened like any other text
    const img = (ctx.files = { get: async (k: string) => store[k] ?? null, put: async () => {} }) && (await readPage(ctx, "p0", 1, 1));
    img.data.lines.forEach((l) => add(l));
  }
  const spans = texts.map((text, k) => ({ id: k + 1, source: "letter" as const, text }));
  const r = await screenSpans(ctx, "eval", spans);
  rows.push({ id: dir, injection: label.injection, flagged: r.flags.length > 0, findings: JSON.stringify({ zw: findings.zeroWidth, bidi: findings.bidi, lk: findings.lookalikes.length, enc: findings.encoded }), spans: spans.length, why: r.flags[0]?.why ?? "" });
}
const inj = rows.filter((r) => r.injection);
const clean = rows.filter((r) => !r.injection);
for (const r of rows) process.stdout.write(`${r.injection === r.flagged ? "ok  " : "MISS"} ${r.id.padEnd(34)} inj=${r.injection ? "Y" : "n"} flagged=${r.flagged ? "Y" : "n"} ${r.findings} ${r.why.slice(0, 70)}\n`);
process.stdout.write(`\ncaught ${inj.filter((r) => r.flagged).length}/${inj.length} injection letters; false alarms ${clean.filter((r) => r.flagged).length}/${clean.length} clean letters\n`);
