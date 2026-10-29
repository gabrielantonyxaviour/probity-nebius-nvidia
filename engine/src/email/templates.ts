// Plain-text e-mail templates with a minimal HTML twin. Short, specific, no marketing.
export type Mail = { subject: string; text: string; html: string };

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function wrap(paragraphs: string[], link?: { label: string; url: string }): string {
  const body = paragraphs.map((p) => `<p style="margin:0 0 14px">${esc(p)}</p>`).join("");
  const a = link ? `<p style="margin:18px 0"><a href="${esc(link.url)}" style="color:#0b5cad">${esc(link.label)}</a></p>` : "";
  return `<div style="font:15px/1.5 -apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a;max-width:520px">${body}${a}<p style="margin:24px 0 0;color:#666;font-size:13px">Probity - vendor bank-change checks</p></div>`;
}

export function signInCodeEmail(code: string): Mail {
  const lines = [`Your Probity sign-in code is ${code}.`, "It works for 5 minutes. If you did not ask for it, you can ignore this message."];
  return { subject: `${code} is your Probity sign-in code`, text: `${lines.join("\n\n")}\n`, html: wrap(lines) };
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
  const lines = [
    `${i.vendor} asked to change bank details (${i.requestId}). Probity has put it on hold.`,
    i.reason,
    ...(i.amount ? [`Next payment affected: ${i.amount}.`] : []),
    i.callbackPhone ? `Call the vendor on the number already in your records: ${i.callbackPhone}. Do not use the number in the request.` : "No phone number is on file for this vendor. Find one from a source you already trust before paying.",
  ];
  const text = `${lines.join("\n\n")}\n\nReview and decide: ${i.link}\n`;
  return { subject: `Hold: ${i.vendor} asked to change bank details`, text, html: wrap(lines, { label: "Review the request", url: i.link }) };
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

export function preRunSummaryEmail(i: PreRunSummaryInput): Mail {
  const head = `${i.weekday}'s run, cut-off ${i.cutoff}: ${plural(i.cleared, "change", "changes")} cleared, ${i.onHold} on hold, ${i.needsCall} ${i.needsCall === 1 ? "needs" : "need"} a call.`;
  const lines = [head, "Anything on hold or waiting for a call will not be released with this run until someone signs it off."];
  return { subject: `${i.weekday}'s payment run: ${i.onHold} on hold, ${i.needsCall} to call`, text: `${lines.join("\n\n")}\n\nOpen the run: ${i.link}\n`, html: wrap(lines, { label: "Open the run", url: i.link }) };
}
