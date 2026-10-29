// The e-mail that came with the letter: its header block and body, split into spans a screen can read one by one.
import type { Span } from "../prompts/screen";

/** `headersOnly`: the body is already screened as the letter. */
export function emailSpans(emlText: string, startId: number, headersOnly = false): Span[] {
  if (!emlText.trim()) return [];
  const [head = "", ...rest] = emlText.replace(/\r\n/g, "\n").split(/\n\n/);
  const unfolded = head.replace(/\n[ \t]+/g, " ");
  const wanted = unfolded.split("\n").filter((l) => /^(from|reply-to|subject|x-[a-z-]+):/i.test(l));
  const body = rest.join("\n\n").split("\n");
  const texts = [...wanted, ...(headersOnly ? [] : body)].map((t) => t.trim()).filter((t) => t.length > 2);
  return texts.slice(0, 40).map((text, k) => ({ id: startId + k, source: "email" as const, text }));
}

/** From, Reply-To, Subject and the SPF/DKIM verdicts out of a raw e-mail header block. */
export function parseEml(text: string) {
  const head = text.replace(/\r\n/g, "\n").split(/\n\n/)[0]!.replace(/\n[ \t]+/g, " ");
  const h = (name: string) => new RegExp(`^${name}:\\s*(.+)$`, "im").exec(head)?.[1]?.trim() ?? null;
  const auth = (k: string) => new RegExp(`\\b${k}=([a-z]+)`, "i").exec(head)?.[1]?.toLowerCase() ?? null;
  const from = h("From") ?? "unknown";
  return { from, replyTo: h("Reply-To"), subject: h("Subject") ?? "(no subject)", spf: auth("spf"), dkim: auth("dkim"), sender: /<?([^<>\s"]+@[^<>\s"]+)>?\s*$/.exec(from)?.[1] ?? "unknown" };
}
