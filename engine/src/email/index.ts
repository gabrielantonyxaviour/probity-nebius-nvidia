// E-mail module (Sonnet C): sendEmail() for sign-in codes, hold alerts and the pre-run summary.
// Sends through Resend's HTTP API. Without a verified sending domain (EMAIL_FROM unset) or a key, the message is
// written to the email_outbox table instead and the call still succeeds, so sign-in works in local development.
import type { CEnv } from "../auth/types";

export type OutgoingEmail = { to: string | string[]; subject: string; text: string; html?: string };
export type SendResult = { ok: boolean; delivered: boolean; id?: string; error?: string };

export { signInCodeEmail, holdAlertEmail, preRunSummaryEmail } from "./templates";
export type { HoldAlertInput, PreRunSummaryInput } from "./templates";

const RESEND_URL = "https://api.resend.com/emails";

async function toOutbox(env: CEnv, mail: OutgoingEmail, to: string[], status: string): Promise<void> {
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
  if (!env.RESEND_API_KEY || !env.EMAIL_FROM) {
    await toOutbox(env, mail, to, "outbox");
    return { ok: true, delivered: false };
  }
  try {
    const res = await fetch(RESEND_URL, {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.EMAIL_FROM, to, subject: mail.subject, text: mail.text, ...(mail.html ? { html: mail.html } : {}) }),
    });
    const body = (await res.json().catch(() => ({}))) as { id?: string; message?: string };
    if (!res.ok) {
      await toOutbox(env, mail, to, `failed_${res.status}`);
      return { ok: false, delivered: false, error: body.message ?? `Resend answered ${res.status}.` };
    }
    return { ok: true, delivered: true, id: body.id };
  } catch {
    await toOutbox(env, mail, to, "failed_network");
    return { ok: false, delivered: false, error: "Could not reach the e-mail service." };
  }
}
