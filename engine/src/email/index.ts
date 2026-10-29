// E-mail module (Sonnet C): sendEmail() for sign-in codes, hold alerts and the pre-run summary.
// Sends through the Cloudflare Email Service Workers binding (env.EMAIL, `send_email` in wrangler). Without the binding
// or EMAIL_FROM, the message is written to the email_outbox table instead and the call still succeeds, so sign-in works in local development.
// A deployed (https) app without EMAIL_FROM fails with code email_unconfigured instead.
import type { CEnv } from "../auth/types";

/** noOutbox: a failed send in production is not kept in the outbox (sign-in codes). */
export type OutgoingEmail = { to: string | string[]; subject: string; text: string; html?: string; noOutbox?: boolean };
export type SendResult = { ok: boolean; delivered: boolean; id?: string; error?: string; code?: "email_unconfigured" | "email_failed" };

export { signInCodeEmail, holdAlertEmail, preRunSummaryEmail } from "./templates";
export type { HoldAlertInput, PreRunSummaryInput } from "./templates";

const deployed = (env: CEnv) => (env.APP_URL ?? "").startsWith("https://");

/** "Probity <notifications@probity.larinova.com>" or a bare address. */
export function parseFrom(from: string): string | { name: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m && m[1] ? { name: m[1].trim(), email: m[2]!.trim() } : (m ? m[2]!.trim() : from.trim());
}

async function toOutbox(env: CEnv, mail: OutgoingEmail, to: string[], status: string): Promise<void> {
  if (mail.noOutbox && deployed(env)) return;
  const now = new Date().toISOString();
  await env.DB.batch(
    to.map((addr) =>
      env.DB.prepare("INSERT INTO email_outbox (to_addr, subject, text, html, status, created_at) VALUES (?, ?, ?, ?, ?, ?)").bind(addr, mail.subject, mail.text, mail.html ?? null, status, now),
    ),
  );
}

export async function sendEmail(env: CEnv, mail: OutgoingEmail): Promise<SendResult> {
  const to = (Array.isArray(mail.to) ? mail.to : [mail.to]).map((a) => a.trim()).filter(Boolean);
  if (to.length === 0) return { ok: false, delivered: false, error: "No recipient." };
  if (!env.EMAIL || !env.EMAIL_FROM) {
    // Deployed: never pretend a mail went out, and never keep a sign-in code anywhere a person could read it.
    if (deployed(env)) return { ok: false, delivered: false, error: "E-mail sending isn't set up yet.", code: "email_unconfigured" };
    await toOutbox(env, mail, to, "outbox");
    return { ok: true, delivered: false };
  }
  try {
    const res = await env.EMAIL.send({ from: parseFrom(env.EMAIL_FROM), to, subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}) });
    return { ok: true, delivered: true, id: res.messageId };
  } catch (e) {
    const err = e as { code?: string; message?: string };
    await toOutbox(env, mail, to, `failed_${(err.code ?? "unknown").toLowerCase()}`);
    return { ok: false, delivered: false, error: err.message ?? "The e-mail service refused the message.", code: "email_failed" };
  }
}
