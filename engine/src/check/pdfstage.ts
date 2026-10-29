// Step `pdf`: load the request, open the letter, find what a person cannot see, render the pages.
import type { Run } from "@probity/shared";
import { getRequest } from "../evidence";
import { analyzePdf } from "../pdf";
import { phonesIn } from "../policy/normalise";
import type { Ctx, Scratch, StageOut } from "./types";

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export async function pdfStage(ctx: Ctx): Promise<StageOut> {
  const run = await ctx.store.get(ctx.runId);
  const req = await getRequest(ctx.env, run.requestId);
  const bytes = await ctx.files.get(req.letterKey);
  if (!bytes) throw new Error("The letter file for this request is missing.");
  const a = await analyzePdf(bytes, {
    wasm: ctx.wasm,
    storePage: async (i, png) => {
      const key = `pages/${ctx.runId}/${i + 1}.png`;
      await ctx.files.put(key, png, "image/png");
      return key;
    },
  });
  const request = {
    requestId: req.requestId, vendorId: req.vendorId, vendorName: req.vendorOnFile.legalName || req.vendorName, kind: req.kind, senderEmail: req.senderEmail,
    amountAtRisk: req.amountAtRisk, nextRunAt: req.nextRunAt, email: req.email, vendorOnFile: req.vendorOnFile, receivedAt: req.receivedAt,
  };
  const scratch: Scratch = {
    request, emlText: req.emlText, lines: a.lines, letterPhones: [...new Set(a.lines.flatMap((l) => phonesIn(l.text)))], withheld: [], claims: [], pressure: [],
    textAccount: null, readingsDisagree: [], examiner: null, pageKeys: a.pageKeys,
  };
  await ctx.store.update(ctx.runId, (r: Run) => {
    r.vendorName = request.vendorName;
    r.letter = { pageCount: a.pageCount, pageImages: a.pageKeys, pageSize: a.pageSize, claims: [], hidden: a.hidden, scanned: a.scanned };
  });
  const hidden = a.hidden.length ? `; ${plural(a.hidden.length, "line", "lines")} a person cannot see` : "";
  return { scratch, summary: `${plural(a.pageCount, "page", "pages")} read${a.scanned ? " (scanned, no text layer)" : ""}${hidden}${a.truncated ? "; only the first pages were used" : ""}` };
}
