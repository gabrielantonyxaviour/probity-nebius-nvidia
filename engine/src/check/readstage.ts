// Steps `read_text` (Nemotron 3 Ultra, thinking on) and `read_image` (Nemotron 3.5 Super VL): two independent readings of the letter.
import type { Claim, HiddenText, Run, Screen } from "@probity/shared";
import { imagePart, type ChatOptions } from "../models/client";
import { callJson } from "../models/structured";
import { digits, validAba } from "../policy/normalise";
import type { Pressure } from "../policy/types";
import { READER_IMAGE_SYSTEM, READER_TEXT_SYSTEM, readerImageUser, readerTextUser } from "../prompts/reader";
import { screenSpans } from "./screenstage";
import { accountOf, collapseRuns, sameClaimValue, toClaims } from "./claims";
import { ImageReading, TextReading, type RawClaim } from "./schemas";
import type { Ctx, Scratch, StageOut } from "./types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const words = (s: string) => (s.toLowerCase().match(/[a-z0-9]{3,}/g) ?? []) as string[];
const URGENT = /urgent|immediate|asap|today|right away|without delay|not be delayed|avoid(?:ing)? delay|deadline|as soon as|time[- ]sensitive/i;
/** Only a short quote that really pushes for speed counts as urgency; models over-quote. */
const sane = (p: Pressure) => p.quote.length <= 240 && (p.kind !== "urgency" || URGENT.test(p.quote));
const dedupePressure = (all: Pressure[]): Pressure[] => {
  const kept = all.filter(sane);
  return kept.filter((p, i) => kept.findIndex((q) => q.kind === p.kind && words(q.quote).join() === words(p.quote).join()) === i);
};

export async function readTextStage(ctx: Ctx, s: Scratch): Promise<StageOut> {
  const run = await ctx.store.get(ctx.runId);
  if (run.letter?.scanned) return { scratch: s, summary: "No text layer in this PDF; the page image is the only reading", skipped: true };
  const shown = s.lines.filter((l) => !l.hidden).map((l) => ({ id: l.id, text: s.withheld.includes(l.id) ? "[withheld]" : l.text }));
  const res = await callJson(
    ctx.env,
    { model: "nvidia/Nemotron-3-Ultra-550b-a55b", thinking: true, agent: "letter_reader", stepKey: "read_text", maxTokens: 9000, messages: [{ role: "system", content: READER_TEXT_SYSTEM }, { role: "user", content: readerTextUser(shown) }] },
    { name: "letter_reading", schema: TextReading },
  );
  const sourceText = shown.filter((l) => l.text !== "[withheld]").map((l) => l.text).join("\n");
  const claims = toClaims(res.data.claims, sourceText, false);
  const acct = await accountOf(res.data.claims);
  await ctx.store.update(ctx.runId, (r: Run) => {
    if (r.letter) r.letter.claims = claims;
  });
  return {
    scratch: { ...s, claims, pressure: dedupePressure(res.data.pressure), textAccount: acct ? { hash: acct.hash, digitsHash: acct.digitsHash, last4: acct.last4 } : null },
    summary: `${plural(claims.length, "claim", "claims")} read from the text layer`,
    calls: res.calls,
  };
}

const RETRY_HINT = " Read the routing number and the account number again, digit by digit. A routing number has exactly 9 digits. Count the digits, including repeated zeros.";

async function readPage(ctx: Ctx, key: string, n: number, total: number, hint = "") {
  const png = await ctx.files.get(key);
  if (!png) throw new Error("A page image is missing.");
  const messages: ChatOptions["messages"] = [
    { role: "system", content: READER_IMAGE_SYSTEM },
    { role: "user", content: [imagePart(png), { type: "text", text: readerImageUser(n, total) + hint }] },
  ];
  return callJson(ctx.env, { model: "nvidia/Nemotron-3.5-Super-VL", thinking: false, agent: "letter_reader", stepKey: "read_image", maxTokens: 4000, messages }, { name: "page_reading", schema: ImageReading });
}

type Pages = Awaited<ReturnType<typeof readPage>>[];

/** Where the two readings of the money details differ. A routing number that fails its checksum is a misread, not a disagreement. */
async function compareMoney(s: Scratch, raw: RawClaim[]) {
  const acct = await accountOf(raw);
  const textRouting = s.claims.find((c) => c.field === "routing_number")?.value;
  const imgRoutings = raw.filter((c) => c.field === "routing_number").map((c) => digits(c.value));
  const disagree: string[] = [];
  if (s.textAccount && acct && s.textAccount.digitsHash !== acct.digitsHash) disagree.push("account number");
  if (textRouting && imgRoutings.length && !imgRoutings.some((x) => collapseRuns(x) === collapseRuns(digits(textRouting))) && !(validAba(textRouting) && imgRoutings.every((r) => !validAba(r)))) disagree.push("routing number");
  return { acct, disagree };
}

/** Text-layer lines a person looking at the page image would have seen, but the image reading did not contain. */
export function linesMissingFromImage(s: Scratch, imageLines: string[]): HiddenText[] {
  const bag = new Set(imageLines.flatMap(words));
  if (imageLines.length < 3 || bag.size < 6) return [];
  const out: HiddenText[] = [];
  for (const l of s.lines) {
    if (l.hidden || s.withheld.includes(l.id)) continue;
    const w = words(l.text);
    if (w.length < 3) continue;
    const share = w.filter((t) => bag.has(t)).length / w.length;
    if (share < 0.4) out.push({ page: l.page, text: l.text, why: "not_in_page_image", detail: "In the text layer, but not in the picture of the page", bbox: l.bbox });
  }
  return out;
}

export async function readImageStage(ctx: Ctx, s: Scratch): Promise<StageOut> {
  const total = s.pageKeys.length;
  let pages: Pages = await Promise.all(s.pageKeys.map((k, i) => readPage(ctx, k, i + 1, total)));
  const calls = pages.flatMap((p) => p.calls);
  let raw: RawClaim[] = pages.flatMap((p) => p.data.claims);
  let { acct, disagree } = await compareMoney(s, raw);
  if (disagree.length) {
    // One more careful look: a vision model can drop a zero from a run of zeros.
    pages = await Promise.all(s.pageKeys.map((k, i) => readPage(ctx, k, i + 1, total, RETRY_HINT)));
    calls.push(...pages.flatMap((p) => p.calls));
    raw = pages.flatMap((p) => p.data.claims);
    ({ acct, disagree } = await compareMoney(s, raw));
  }
  const imageLines = pages.flatMap((p) => p.data.lines);
  const run = await ctx.store.get(ctx.runId);
  const scanned = !!run.letter?.scanned;
  const imgClaims = toClaims(raw, null, true);

  // Text claims the picture also shows; picture-only claims are added.
  const merged: Claim[] = s.claims.map((c) => ({ ...c, inImage: imgClaims.some((i) => i.field === c.field && sameClaimValue(c.field, i.value, c.value)) }));
  for (const i of imgClaims) if (!merged.some((c) => c.field === i.field && sameClaimValue(c.field, i.value, c.value))) merged.push(i);

  const missing = scanned ? [] : linesMissingFromImage(s, imageLines);
  // A scan has no text layer to screen, so the lines read from the picture are screened instead.
  let extraFlags: Screen["flags"] = [];
  if (scanned && imageLines.length) {
    const screened = await screenSpans(ctx, "read_image", imageLines.slice(0, 80).map((text, k) => ({ id: k + 1, source: "letter" as const, text })));
    extraFlags = screened.flags;
    calls.push(...screened.calls);
  }
  const pressure = scanned || s.pressure.length === 0 ? dedupePressure([...s.pressure, ...pages.flatMap((p) => p.data.pressure)]) : s.pressure;
  await ctx.store.update(ctx.runId, (r: Run) => {
    if (r.letter) {
      r.letter.claims = merged;
      r.letter.hidden = [...r.letter.hidden, ...missing];
    }
    if (scanned && r.screen) r.screen = { spansScreened: r.screen.spansScreened + Math.min(imageLines.length, 80), flags: [...r.screen.flags, ...extraFlags] };
  });
  const seen = merged.filter((c) => c.inImage).length;
  const summary = `${seen} of ${merged.length} claims also seen on the page image${missing.length ? `; ${plural(missing.length, "text line", "text lines")} not on the page` : ""}${disagree.length ? `; the two readings disagree on the ${disagree.join(" and ")}` : ""}`;
  const textAccount = s.textAccount ?? (acct ? { hash: acct.hash, digitsHash: acct.digitsHash, last4: acct.last4 } : null);
  return { scratch: { ...s, claims: merged, pressure, textAccount, readingsDisagree: disagree }, summary, calls };
}
