// The e-mail that came with the letter: its header block and body, split into spans a screen can read one by one.
import type { Span } from "../prompts/screen";

export function emailSpans(emlText: string, startId: number): Span[] {
  if (!emlText.trim()) return [];
  const [head = "", ...rest] = emlText.replace(/\r\n/g, "\n").split(/\n\n/);
  const unfolded = head.replace(/\n[ \t]+/g, " ");
  const wanted = unfolded.split("\n").filter((l) => /^(from|reply-to|subject|x-[a-z-]+):/i.test(l));
  const body = rest.join("\n\n").split("\n");
  const texts = [...wanted, ...body].map((t) => t.trim()).filter((t) => t.length > 2);
  return texts.slice(0, 40).map((text, k) => ({ id: startId + k, source: "email" as const, text }));
}
