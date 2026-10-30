// Block Kit for the "check finished" message and its updated form after a button is pressed.
import type { Run } from "@probity/shared";

type Block = Record<string, unknown>;
const EMOJI: Record<string, string> = { APPROVE: ":white_check_mark:", CALLBACK_VERIFY: ":telephone_receiver:", HOLD: ":no_entry:" };
const LABEL: Record<string, string> = { APPROVE: "Clear to pay", CALLBACK_VERIFY: "Call to verify first", HOLD: "On hold" };
const money = (cents: number): string => `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const esc = (t: string): string => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

export function outcomeText(result: "confirmed" | "denied" | "no_answer", by: string): string {
  return result === "confirmed" ? `Confirmed by ${by}: the vendor said they sent it.` : result === "denied" ? `Reported by ${by}: the vendor did not send it. Kept on hold.` : `${by} called and got no answer. Still waiting.`;
}

export function runBlocks(run: Run, o: { amountCents: number | null; appUrl: string; resolved?: string }): { text: string; blocks: Block[] } {
  const d = run.decision;
  const verdict = d?.verdict ?? "HOLD";
  const card = d?.callCard;
  const reasons = (d?.reasons ?? []).slice(0, 3).map((r) => `• ${esc(r.text)}`).join("\n");
  const phone = card?.phone ? `*${esc(card.phone)}*` : "_no independent number found_";
  const sources = card?.sources.length ? ` (${card.sources.map((s) => esc(s.label)).join(", ")})` : "";
  const struck = (card?.letterPhones ?? []).map((p) => `~${esc(p)}~`).join(" ");
  const link = `${o.appUrl}/r/${encodeURIComponent(run.requestId)}`;
  const head = `${EMOJI[verdict] ?? ""} *${LABEL[verdict] ?? verdict}: ${esc(run.vendorName)}*${o.amountCents ? `  ·  ${money(o.amountCents)} at risk` : ""}`;
  const blocks: Block[] = [
    { type: "section", text: { type: "mrkdwn", text: head } },
    ...(reasons ? [{ type: "section", text: { type: "mrkdwn", text: reasons } }] : []),
    { type: "section", text: { type: "mrkdwn", text: `*Call:* ${phone}${sources}${struck ? `\nThe request's own number, do not use: ${struck}` : ""}` } },
    { type: "context", elements: [{ type: "mrkdwn", text: `<${link}|Open the full check> · ${esc(run.requestId)}` }] },
  ];
  if (o.resolved) blocks.push({ type: "section", text: { type: "mrkdwn", text: `_${esc(o.resolved)}_` } });
  else if (run.status === "done") {
    blocks.push({
      type: "actions",
      block_id: `outcome:${run.id}`,
      elements: [
        { type: "button", action_id: "outcome_confirmed", text: { type: "plain_text", text: "Confirmed" }, style: "primary", value: "confirmed" },
        { type: "button", action_id: "outcome_denied", text: { type: "plain_text", text: "They didn't send it" }, style: "danger", value: "denied" },
        { type: "button", action_id: "outcome_no_answer", text: { type: "plain_text", text: "No answer" }, value: "no_answer" },
      ],
    });
  }
  return { text: `${LABEL[verdict] ?? verdict}: ${run.vendorName}`, blocks };
}

export function summaryBlocks(p: { company: string; weekday: string | null; cutoff: string | null; cleared: number; onHold: number; needsCall: number; flagged: number; appUrl: string }): { text: string; blocks: Block[] } {
  const when = p.weekday && p.cutoff ? `${p.weekday}'s run, cut-off ${p.cutoff}` : "Next payment run";
  const text = `${when}: ${p.cleared} cleared, ${p.onHold} on hold, ${p.needsCall} need a call${p.flagged ? `, ${p.flagged} flagged by the re-check` : ""}.`;
  return { text, blocks: [{ type: "section", text: { type: "mrkdwn", text: `:clipboard: *Pre-run re-check · ${esc(p.company)}*\n${text}` } }, { type: "context", elements: [{ type: "mrkdwn", text: `<${p.appUrl}/|Open the inbox>` }] }] };
}
