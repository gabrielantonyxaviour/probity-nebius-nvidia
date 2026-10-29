// Text hardening before anything is screened or read: Unicode normalisation, invisible characters, look-alike letters, encoded blobs.
// Every finding is kept so the gate can say, in plain words, that the text was disguised.

export interface Findings {
  /** zero-width characters found inside words (U+200B..U+200D, U+2060, U+FEFF, ...) */
  zeroWidth: number;
  /** direction-control characters (U+202A..U+202E, U+2066..U+2069): used to reorder text on screen */
  bidi: number;
  /** words that mix Latin letters with look-alike Cyrillic or Greek letters */
  lookalikes: string[];
  /** base64 text that decoded to readable words (also returned as extra spans) */
  encoded: number;
}

export const noFindings = (): Findings => ({ zeroWidth: 0, bidi: 0, lookalikes: [], encoded: 0 });

export function mergeFindings(a: Findings, b: Findings): Findings {
  return { zeroWidth: a.zeroWidth + b.zeroWidth, bidi: a.bidi + b.bidi, lookalikes: [...new Set([...a.lookalikes, ...b.lookalikes])].slice(0, 6), encoded: a.encoded + b.encoded };
}

export const hasFindings = (f: Findings): boolean => f.zeroWidth + f.bidi + f.lookalikes.length + f.encoded > 0;

const ZERO_WIDTH = /[​-‍⁠-⁤﻿᠎­͏؜ᅟᅠㅤ]/g;
const BIDI = /[‪-‮⁦-⁩‎‏]/g;

// Cyrillic and Greek letters that look like Latin ones. Enough to see through "АI rеviewer".
const LOOKALIKE: Record<string, string> = {
  А: "A", В: "B", Е: "E", К: "K", М: "M", Н: "H", О: "O", Р: "P", С: "C", Т: "T", Х: "X", І: "I", Ј: "J", Ѕ: "S", Ү: "Y",
  а: "a", в: "b", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", і: "i", ј: "j", ѕ: "s", һ: "h", ԁ: "d", ӏ: "l", ѵ: "v",
  Α: "A", Β: "B", Ε: "E", Ζ: "Z", Η: "H", Ι: "I", Κ: "K", Μ: "M", Ν: "N", Ο: "O", Ρ: "P", Τ: "T", Υ: "Y", Χ: "X",
  ο: "o", ν: "v", ι: "i", κ: "k", ρ: "p", υ: "u", α: "a",
};
const NON_LATIN = /[Ͱ-ϿЀ-ӿ]/;

/** Returns the text a reader should see: normalised, with invisible characters removed and look-alike letters mapped to Latin. */
export function sanitize(input: string): { text: string; findings: Findings } {
  const findings = noFindings();
  let t = input.normalize("NFKC");
  findings.bidi = (t.match(BIDI) ?? []).length;
  t = t.replace(BIDI, "");
  // A zero-width character between two letters hides a word from a keyword filter. A lone one at the edge of a line is noise.
  findings.zeroWidth = (t.match(new RegExp(`(?<=[\\p{L}\\p{N}])${ZERO_WIDTH.source}+(?=[\\p{L}\\p{N}])`, "gu")) ?? []).length;
  t = t.replace(ZERO_WIDTH, "");
  const seen = new Set<string>();
  t = t.replace(/[\p{L}]+/gu, (word) => {
    if (!NON_LATIN.test(word)) return word;
    const latin = /[A-Za-z]/.test(word);
    const mapped = [...word].map((ch) => LOOKALIKE[ch] ?? ch).join("");
    const fullyMapped = !NON_LATIN.test(mapped) && /^[A-Za-z]+$/.test(mapped);
    // A real Russian or Greek word is left alone; a word that mixes scripts, or turns into plain Latin letters only through the table, is a disguise.
    if (latin || (fullyMapped && /^[A-Za-z]{2,}$/.test(mapped) && [...word].every((ch) => LOOKALIKE[ch] !== undefined) && word.length <= 12)) {
      if (!seen.has(word)) {
        seen.add(word);
        findings.lookalikes.push(word);
      }
      return mapped;
    }
    return word;
  });
  return { text: t.replace(/[ \t]+/g, " ").trim(), findings };
}

function readable(s: string): boolean {
  if (s.length < 8) return false;
  let good = 0;
  for (const ch of s) if (/[\p{L}\p{N}\s.,;:!?'"()\-_/@&%$#]/u.test(ch)) good++;
  return good / [...s].length > 0.92 && /\p{L}{3,}/u.test(s);
}

/** Base64 blobs in a line that decode to readable text. The decoded text is screened like any other span. */
export function decodedBlobs(text: string): string[] {
  const out: string[] = [];
  for (const m of text.matchAll(/(?<![A-Za-z0-9+/=])[A-Za-z0-9+/]{24,}={0,2}(?![A-Za-z0-9+/=])/g)) {
    const blob = m[0];
    if (blob.length % 4 === 1) continue;
    try {
      const bin = atob(blob.padEnd(Math.ceil(blob.length / 4) * 4, "="));
      const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
      const decoded = new TextDecoder("utf-8", { fatal: true, ignoreBOM: false }).decode(bytes);
      if (readable(decoded)) out.push(decoded.slice(0, 500));
    } catch {
      /* not text */
    }
  }
  return out;
}
