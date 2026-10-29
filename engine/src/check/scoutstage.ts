// Step `scout`: Nemotron 3.5 Super VL runs a tool loop over the evidence lookups (at most 8 tool calls),
// then the engine adds what only it can see: our own ledger of accounts, rejections and call-backs.
import type { Evidence, ModelCall, Run, Screen } from "@probity/shared";
import { z } from "zod";
import { lookupEdgar, lookupGleif, lookupUsaspending, scoutTools, tavilyContact, vendorMaster, type ToolResult } from "../evidence";
import { chat, type Msg } from "../models/client";
import { domainOfAddress } from "../policy/normalise";
import { SCOUT_SYSTEM, scoutUser } from "../prompts/scout";
import { ledgerEvidence } from "./ledger";
import { screenSpans } from "./screenstage";
import type { Ctx, Scratch, StageOut } from "./types";

export const MAX_TOOL_CALLS = 8;

const RESERVED_TLD = new Set(["example", "test", "invalid", "localhost", "local", "internal"]);
/** Tavily rejects a whole search when include_domains holds a domain it cannot resolve (400), so only a real-looking domain is passed as a hint. */
export function webHint(domain: string | null): string | undefined {
  if (!domain) return undefined;
  const d = domain.trim().toLowerCase().replace(/^www\./, "");
  const tld = d.split(".").pop() ?? "";
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(d) && !RESERVED_TLD.has(tld) ? d : undefined;
}
const MAX_ROUNDS = 6;
const NameArgs = z.object({ name: z.string().min(1).max(200) });

type Looked = ToolResult & { creditsUsed?: number; snippets?: string[] };

async function dispatch(ctx: Ctx, s: Scratch, name: string, rawArgs: string): Promise<Looked> {
  let args: unknown = {};
  try {
    args = JSON.parse(rawArgs || "{}");
  } catch {
    return { evidence: [], summary: "The tool arguments were not valid JSON; nothing was looked up." };
  }
  switch (name) {
    case "vendor_master":
      return vendorMaster(ctx.env, { vendorId: s.request.vendorId }); // never any vendor but the one under check
    case "edgar_lookup": {
      const a = z.object({ name: z.string().max(200).optional(), cik: z.string().regex(/^\d{1,10}$/).optional() }).safeParse(args);
      return a.success && (a.data.name || a.data.cik) ? lookupEdgar(ctx.env, a.data) : { evidence: [], summary: "edgar_lookup needs a name or a CIK." };
    }
    case "usaspending_lookup": {
      const a = NameArgs.safeParse(args);
      return a.success ? lookupUsaspending(ctx.env, a.data) : { evidence: [], summary: "usaspending_lookup needs a name." };
    }
    case "gleif_lookup": {
      const a = NameArgs.safeParse(args);
      return a.success ? lookupGleif(ctx.env, a.data) : { evidence: [], summary: "gleif_lookup needs a name." };
    }
    case "web_contact_lookup":
      // Always the vendor of record and its domain on file, whatever name the model (or the letter) suggested.
      return tavilyContact(ctx.env, { company: s.request.vendorName, ...(webHint(s.request.vendorOnFile.domain) ? { domainHint: webHint(s.request.vendorOnFile.domain) } : {}), sessionId: ctx.sessionId });
    default:
      return { evidence: [], summary: `Unknown tool ${name}.` };
  }
}

export async function scoutStage(ctx: Ctx, s: Scratch): Promise<StageOut> {
  const evidence = new Map<string, Evidence>();
  const calls: ModelCall[] = [];
  let toolCount = 0;
  let credits = 0;
  let webSpans = 0;
  const flagsAdded: Screen["flags"] = [];
  const names = s.claims.filter((c) => c.field === "legal_name").map((c) => c.value);

  const publish = () =>
    ctx.store.update(ctx.runId, (r: Run) => {
      r.evidence = [...evidence.values()];
      r.totals.tavilyCredits = credits;
      if (r.screen && (flagsAdded.length || webSpans)) r.screen = { spansScreened: r.screen.spansScreened + webSpans, flags: [...r.screen.flags, ...flagsAdded.splice(0)] };
      webSpans = 0;
    });

  const run = async (name: string, args: string): Promise<string> => {
    toolCount++;
    const res = await dispatch(ctx, s, name, args);
    let usable = res.evidence;
    let message = res.summary;
    if (res.snippets?.length) {
      const screened = await screenSpans(ctx, "scout", res.snippets.map((t, k) => ({ id: k + 1, source: "web" as const, text: t })));
      calls.push(...screened.calls);
      webSpans += res.snippets.length;
      if (screened.flags.length) {
        flagsAdded.push(...screened.flags);
        usable = [];
        message = "Web results were withheld: some of the text was addressed to a reviewer. No facts were taken from them.";
      }
    }
    credits += res.creditsUsed ?? 0;
    for (const e of usable) evidence.set(e.id, e);
    await publish();
    return message;
  };

  const messages: Msg[] = [
    { role: "system", content: SCOUT_SYSTEM },
    { role: "user", content: scoutUser({ vendorId: s.request.vendorId, vendorName: s.request.vendorName, letterNames: names, senderDomain: domainOfAddress(s.request.email.from), kind: s.request.kind }) },
  ];
  const used: string[] = [];
  for (let round = 0; round < MAX_ROUNDS && toolCount < MAX_TOOL_CALLS; round++) {
    const r = await chat(ctx.env, { model: "nvidia/Nemotron-3.5-Super-VL", thinking: false, agent: "registry_scout", stepKey: "scout", messages, tools: scoutTools, toolChoice: "auto", maxTokens: 900 });
    calls.push(r.call);
    if (r.toolCalls.length === 0) break;
    messages.push({ role: "assistant", content: r.content || null, tool_calls: r.toolCalls });
    for (const t of r.toolCalls) {
      const over = toolCount >= MAX_TOOL_CALLS;
      const again = t.function.name === "web_contact_lookup" && used.includes("web_contact_lookup");
      const out = over ? "The limit of 8 tool calls is used up." : again ? "The web lookup was already done for this vendor." : await run(t.function.name, t.function.arguments);
      if (!over && !again) used.push(t.function.name);
      messages.push({ role: "tool", tool_call_id: t.id, content: out });
    }
  }
  // Our own record is always consulted, and a check never runs on registries alone.
  if (!used.includes("vendor_master")) {
    await run("vendor_master", "{}");
    used.push("vendor_master");
  }
  // A check never runs on our own record alone: a registry is always asked.
  if (!used.some((n) => ["edgar_lookup", "usaspending_lookup", "gleif_lookup"].includes(n))) {
    await run("edgar_lookup", JSON.stringify({ name: s.request.vendorName }));
    used.push("edgar_lookup");
  }
  // The web lookup is the second independent source for the call card, so it never depends on the model's mood.
  let webByCode = false;
  if (!used.includes("web_contact_lookup")) {
    await run("web_contact_lookup", "{}");
    used.push("web_contact_lookup");
    webByCode = true;
  }
  const ledger = await ledgerEvidence(ctx.env, s);
  for (const e of ledger) evidence.set(e.id, e);
  await publish();

  const by = new Map<string, number>();
  for (const e of evidence.values()) by.set(e.source, (by.get(e.source) ?? 0) + 1);
  const detail = [...by.entries()].map(([k, n]) => `${n} from ${k.replace("_", " ")}`).join(", ");
  return { scratch: s, summary: `${toolCount} lookups; ${evidence.size} facts${detail ? ` (${detail})` : ""}${webByCode ? "; web lookup run by code" : ""}`, calls };
}
