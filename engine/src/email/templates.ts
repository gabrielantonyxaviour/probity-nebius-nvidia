// E-mail templates: a branded HTML version (see layout.ts) and a plain-text twin for every message.
import { button, esc, label, muted, p, shell, style } from "./layout";

export type Mail = { subject: string; text: string; html: string };
const { C, SERIF, SANS, MONO } = style;

export function signInCodeEmail(code: string): Mail {
  const text = `Your Probity sign-in code is ${code}.\n\nIt works for 5 minutes. If you did not ask for it, you can ignore this message.\n`;
  const body = [
    `<h1 style="margin:0 0 8px;font:400 28px/1.15 ${SERIF};color:${C.ink};letter-spacing:-.02em">Your sign-in code</h1>`,
    p("Enter this code on the Probity sign-in page. It works for 5 minutes."),
    `<div style="margin:20px 0 22px;padding:18px 0;border:1px solid ${C.rule};border-radius:10px;background:${C.bg};text-align:center;font:600 34px/1 ${MONO};letter-spacing:.32em;color:${C.ink}">${esc(code)}</div>`,
    muted("If you didn't ask for this code, you can ignore this e-mail. Nobody can sign in without it."),
  ].join("");
  return { subject: `${code} is your Probity sign-in code`, text, html: shell(`Your code is ${code}. It works for 5 minutes.`, body) };
}

export type HoldAlertInput = {
  vendor: string;
  requestId: string;
  reason: string; // one plain sentence: "The new account was first seen on a web-form e-mail from a look-alike domain."
  callbackPhone: string | null; // the number on file, not the one in the request
  amount?: string; // "$48,200.00"
  link: string; // absolute URL of the request
};

export function holdAlertEmail(i: HoldAlertInput): Mail {
  const call = i.callbackPhone
    ? `Call the vendor on the number already in your records: ${i.callbackPhone}. Do not use the number in the request.`
    : "No phone number is on file for this vendor. Find one from a source you already trust before paying.";
  const lines = [`${i.vendor} asked to change bank details (${i.requestId}). Probity has put it on hold.`, i.reason, ...(i.amount ? [`Next payment affected: ${i.amount}.`] : []), call];
  const text = `${lines.join("\n\n")}\n\nReview and decide: ${i.link}\n`;
  const body = [
    `<span style="display:inline-block;margin:0 0 14px;padding:3px 10px;border-radius:999px;background:${C.holdBg};font:600 11px/1.6 ${MONO};letter-spacing:.08em;text-transform:uppercase;color:${C.hold}">&#10005; Hold</span>`,
    `<h1 style="margin:0 0 6px;font:400 26px/1.2 ${SERIF};color:${C.ink};letter-spacing:-.02em">${esc(i.vendor)} asked to change where you pay them.</h1>`,
    muted(`${esc(i.requestId)}${i.amount ? ` · ${esc(i.amount)} in the next payment run` : ""}`),
    p(esc(i.reason)),
    `<div style="margin:18px 0 0;padding:16px 18px;border-radius:10px;border:1px solid ${C.rule}">`,
    label(i.callbackPhone ? "Call the vendor on" : "Before paying"),
    i.callbackPhone
      ? `<p style="margin:0 0 6px;font:600 24px/1.2 ${MONO};color:${C.ink}">${esc(i.callbackPhone)}</p><p style="margin:0;font:13px/1.5 ${SANS};color:${C.muted}">The number already in your records. Never the one in the request.</p>`
      : `<p style="margin:0;font:15px/1.5 ${SANS};color:${C.ink}">No phone number is on file. Find one from a source you already trust.</p>`,
    `</div>`,
    button("Review the request", i.link),
  ].join("");
  return { subject: `Hold: ${i.vendor} asked to change bank details`, text, html: shell(`${i.vendor}: bank-change request on hold.`, body) };
}

export type PreRunSummaryInput = {
  weekday: string; // "Friday"
  cutoff: string; // "14:00"
  cleared: number;
  onHold: number;
  needsCall: number;
  link: string;
  company?: string;
};

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

function stat(n: number, word: string, color: string): string {
  return `<td width="33%" style="padding:14px 10px;border:1px solid ${C.rule};border-radius:10px;text-align:center">
<div style="font:400 30px/1 ${SERIF};color:${color}">${n}</div><div style="margin-top:6px;font:12px/1.3 ${SANS};color:${C.muted}">${word}</div></td>`;
}

export function preRunSummaryEmail(i: PreRunSummaryInput): Mail {
  const head = `${i.weekday}'s run, cut-off ${i.cutoff}: ${plural(i.cleared, "change", "changes")} cleared, ${i.onHold} on hold, ${i.needsCall} ${i.needsCall === 1 ? "needs" : "need"} a call.`;
  const note = "Anything on hold or waiting for a call will not be released with this run until someone signs it off.";
  const body = [
    label(`${i.company ? `${i.company} · ` : ""}Pre-run re-check`),
    `<h1 style="margin:0 0 16px;font:400 26px/1.2 ${SERIF};color:${C.ink};letter-spacing:-.02em">${esc(i.weekday)}'s payment run, cut-off ${esc(i.cutoff)}</h1>`,
    `<table role="presentation" width="100%" cellpadding="0" cellspacing="6" style="margin:0 -6px 14px"><tr>${stat(i.cleared, "cleared", C.ok)}${stat(i.onHold, "on hold", C.hold)}${stat(i.needsCall, "need a call", C.call)}</tr></table>`,
    p(note),
    button("Open the run", i.link),
  ].join("");
  return { subject: `${i.weekday}'s payment run: ${i.onHold} on hold, ${i.needsCall} to call`, text: `${head}\n\n${note}\n\nOpen the run: ${i.link}\n`, html: shell(head, body) };
}
