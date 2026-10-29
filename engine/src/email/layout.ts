// Branded HTML shell for every Probity e-mail. Table layout and inline styles only, so Gmail, Outlook and Apple Mail
// render it the same; no web fonts or scripts. The mark is one small hosted PNG with an empty alt, so the wordmark still reads if images are off.
export const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const C = { bg: "#f9f5ef", card: "#ffffff", ink: "#27251e", muted: "#625d58", rule: "#e6e1d9", hold: "#a23544", holdBg: "#f6e9e7", call: "#914a27", ok: "#136a22" };
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif";
const MONO = "'SFMono-Regular',Menlo,Consolas,'Courier New',monospace";

export const style = { C, SERIF, SANS, MONO };

export const p = (html: string, extra = "") => `<p style="margin:0 0 14px;font:15px/1.55 ${SANS};color:${C.ink};${extra}">${html}</p>`;
export const muted = (html: string) => `<p style="margin:0 0 12px;font:13px/1.5 ${SANS};color:${C.muted}">${html}</p>`;
export const label = (t: string, color = C.muted) => `<p style="margin:0 0 6px;font:600 11px/1.4 ${MONO};letter-spacing:.08em;text-transform:uppercase;color:${color}">${esc(t)}</p>`;

export function button(text: string, url: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0 4px"><tr><td style="background:${C.ink};border-radius:8px">
<a href="${esc(url)}" style="display:inline-block;padding:12px 20px;font:600 15px/1 ${SANS};color:#ffffff;text-decoration:none">${esc(text)}</a></td></tr></table>`;
}

/** The whole e-mail: preheader, wordmark, white card with `body`, and the footer. */
export function shell(preheader: string, body: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light"><title>Probity</title></head>
<body style="margin:0;padding:0;background:${C.bg}">
<span style="display:none;max-height:0;overflow:hidden;opacity:0">${esc(preheader)}</span>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:520px">
<tr><td style="padding:0 4px 18px">
  <table role="presentation" cellpadding="0" cellspacing="0"><tr>
    <td style="vertical-align:middle"><img src="https://probity.pages.dev/brand/probity-mark-email.png" width="30" height="23" alt="" style="display:block;border:0"></td>
    <td style="padding-left:9px;font:24px/1 ${SERIF};color:${C.ink};letter-spacing:-.02em">Probity</td>
  </tr></table>
</td></tr>
<tr><td style="background:${C.card};border:1px solid ${C.rule};border-radius:12px;padding:28px 28px 24px">${body}</td></tr>
<tr><td style="padding:18px 4px 0;font:12px/1.6 ${SANS};color:${C.muted}">
  Probity checks vendor bank-change requests before the payment run, on NVIDIA Nemotron and Nebius.<br>
  <a href="https://probity.pages.dev" style="color:${C.muted}">probity.pages.dev</a> · <a href="https://probity.pages.dev/privacy" style="color:${C.muted}">Privacy</a>
</td></tr>
</table></td></tr></table></body></html>`;
}
