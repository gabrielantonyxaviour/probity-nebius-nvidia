// Slack, our own app: OAuth v2 install (the admin picks the channel on Slack's screen), run notifications with buttons,
// and the signed interactivity endpoint. Bot tokens are sealed in D1 with a key derived from the Slack client secret.
import { Hono } from "hono";
import { Run } from "@probity/shared";
import { logOutcome } from "../check/outcome";
import { sendEmail, holdAlertEmail } from "../email";
import type { AppEnv } from "../routes/util";
import { appUrl, nowIso, type IntEnv } from "./env";
import { runBlocks, outcomeText, summaryBlocks } from "./slack-blocks";
import { getConn, saveConn, type ConnRow } from "./store";
import { hmacHex, seal, timingSafeEqual, unseal } from "./util";

export const slackRoutes = new Hono<AppEnv>();
type SlackMeta = { teamName: string; channelId: string; channelName: string; token: string };

export async function slackStart(env: IntEnv, orgId: string, userId: string | null): Promise<string> {
  if (!env.SLACK_CLIENT_ID || !env.SLACK_CLIENT_SECRET) throw new Error("slack not configured");
  const attempt = crypto.randomUUID();
  await env.DB.prepare("INSERT INTO connection_attempts (id, org_id, provider, user_id, connected_account_id, created_at) VALUES (?1,?2,'slack',?3,NULL,?4)").bind(attempt, orgId, userId, nowIso()).run();
  const u = new URL("https://slack.com/oauth/v2/authorize");
  u.search = new URLSearchParams({ client_id: env.SLACK_CLIENT_ID, scope: "chat:write,chat:write.public,incoming-webhook", redirect_uri: `${appUrl(env)}/api/connections/callback`, state: attempt }).toString();
  return u.toString();
}

export async function slackCallback(env: IntEnv, q: { code?: string; state?: string; error?: string }, back: (k: "connected" | "error", p: string) => Response): Promise<Response> {
  const row = q.state ? await env.DB.prepare("SELECT org_id, created_at FROM connection_attempts WHERE id = ?1 AND provider = 'slack'").bind(q.state).first<{ org_id: string; created_at: string }>() : null;
  if (!row || Date.now() - Date.parse(row.created_at) > 30 * 60_000 || !q.code || q.error) return back("error", "slack");
  await env.DB.prepare("DELETE FROM connection_attempts WHERE id = ?1").bind(q.state).run();
  try {
    const res = await fetch("https://slack.com/api/oauth.v2.access", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.SLACK_CLIENT_ID ?? "", client_secret: env.SLACK_CLIENT_SECRET ?? "", code: q.code, redirect_uri: `${appUrl(env)}/api/connections/callback` }), signal: AbortSignal.timeout(15_000) });
    const j = (await res.json()) as { ok?: boolean; access_token?: string; team?: { name?: string }; incoming_webhook?: { channel?: string; channel_id?: string } };
    if (!j.ok || !j.access_token || !j.incoming_webhook?.channel_id) throw new Error("oauth failed");
    const meta: SlackMeta = { teamName: j.team?.name ?? "Slack", channelId: j.incoming_webhook.channel_id, channelName: j.incoming_webhook.channel ?? "", token: await seal(env.SLACK_CLIENT_SECRET ?? "", j.access_token) };
    await saveConn(env, row.org_id, "slack", { status: "connected", account: `${meta.channelName.startsWith("#") ? meta.channelName : `#${meta.channelName}`} · ${meta.teamName}`, detail: null, meta: JSON.stringify(meta), connected_at: nowIso() });
    return back("connected", "slack");
  } catch {
    await saveConn(env, row.org_id, "slack", { status: "error", detail: "Slack did not finish the install. Try again." });
    return back("error", "slack");
  }
}

export async function slackDisconnect(env: IntEnv, row: ConnRow): Promise<void> {
  const meta = parseMeta(row);
  const token = meta && env.SLACK_CLIENT_SECRET ? await unseal(env.SLACK_CLIENT_SECRET, meta.token) : null;
  if (token) await fetch("https://slack.com/api/auth.revoke", { method: "POST", headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(10_000) }).catch(() => undefined);
}

function parseMeta(row: ConnRow | null): SlackMeta | null {
  try { return row?.meta ? (JSON.parse(row.meta) as SlackMeta) : null; } catch { return null; }
}
async function api(env: IntEnv, meta: SlackMeta, method: string, body: unknown): Promise<{ ok: boolean; ts?: string; error?: string }> {
  const token = env.SLACK_CLIENT_SECRET ? await unseal(env.SLACK_CLIENT_SECRET, meta.token) : null;
  if (!token) return { ok: false, error: "token_unreadable" };
  try {
    const res = await fetch(`https://slack.com/api/${method}`, { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json; charset=utf-8" }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000) });
    return (await res.json()) as { ok: boolean; ts?: string; error?: string };
  } catch {
    return { ok: false, error: "network" };
  }
}

async function notifyEmails(env: IntEnv, orgId: string): Promise<string[]> {
  const s = await env.DB.prepare("SELECT notify_emails_json FROM schedules WHERE org_id = ?1").bind(orgId).first<{ notify_emails_json: string }>();
  try { return s ? (JSON.parse(s.notify_emails_json) as string[]) : []; } catch { return []; }
}

/** Tells the company's Slack channel a check finished (with buttons to log the call), and e-mails the notify list when it is a HOLD. Never throws. */
export async function notifyRunFinished(env: IntEnv, orgId: string, runId: string): Promise<void> {
  try {
    const row = await env.DB.prepare("SELECT json FROM runs WHERE id = ?1 AND org_id = ?2").bind(runId, orgId).first<{ json: string }>();
    const parsed = row ? Run.safeParse(JSON.parse(row.json)) : null;
    if (!parsed?.success || parsed.data.status !== "done") return;
    const run = parsed.data;
    const decision = run.decision;
    if (!decision) return;
    const req = await env.DB.prepare("SELECT amount_cents FROM requests WHERE id = ?1").bind(run.requestId).first<{ amount_cents: number }>();
    const slack = parseMeta(await getConn(env, orgId, "slack"));
    if (slack) {
      const msg = runBlocks(run, { amountCents: req?.amount_cents ?? null, appUrl: appUrl(env) });
      const r = await api(env, slack, "chat.postMessage", { channel: slack.channelId, ...msg });
      if (r.ok && r.ts) await env.DB.prepare("INSERT OR REPLACE INTO slack_posts (run_id, org_id, request_id, channel, ts, created_at) VALUES (?1,?2,?3,?4,?5,?6)").bind(runId, orgId, run.requestId, slack.channelId, r.ts, nowIso()).run();
    }
    if (decision.verdict === "HOLD") {
      const to = await notifyEmails(env, orgId);
      if (to.length > 0) {
        const amount = req ? `$${(req.amount_cents / 100).toLocaleString("en-US", { minimumFractionDigits: 2 })}` : undefined;
        await sendEmail(env, { to, ...holdAlertEmail({ vendor: run.vendorName, requestId: run.requestId, reason: decision.reasons[0]?.text ?? "The request did not pass the checks.", callbackPhone: decision.callCard.phone, amount, link: `${appUrl(env)}/r/${encodeURIComponent(run.requestId)}` }) });
      }
    }
  } catch {
    // a notification failure must never fail a check
  }
}

/** The pre-run summary to Slack (e-mail is sent by the caller). */
export async function postSummary(env: IntEnv, orgId: string, p: Omit<Parameters<typeof summaryBlocks>[0], "appUrl">): Promise<void> {
  const slack = parseMeta(await getConn(env, orgId, "slack"));
  if (slack) await api(env, slack, "chat.postMessage", { channel: slack.channelId, ...summaryBlocks({ ...p, appUrl: appUrl(env) }) });
}

/** Slack signs `v0:{timestamp}:{raw body}`; reject anything older than five minutes. */
export async function verifySlack(secret: string, ts: string | undefined, sig: string | undefined, body: string, nowSec = Math.floor(Date.now() / 1000)): Promise<boolean> {
  if (!ts || !sig || Math.abs(nowSec - Number(ts)) > 300) return false;
  return timingSafeEqual(`v0=${await hmacHex(secret, `v0:${ts}:${body}`)}`, sig);
}

slackRoutes.post("/hooks/slack/interact", async (c) => {
  const env = c.env as IntEnv;
  const raw = await c.req.text();
  if (!env.SLACK_SIGNING_SECRET || !(await verifySlack(env.SLACK_SIGNING_SECRET, c.req.header("x-slack-request-timestamp"), c.req.header("x-slack-signature"), raw))) return c.json({ error: "Signature missing or invalid.", code: "unauthorized" }, 401);
  let payload: { type?: string; user?: { name?: string; username?: string }; actions?: Array<{ action_id?: string; value?: string; block_id?: string }>; message?: { ts?: string }; channel?: { id?: string }; team?: { domain?: string } };
  try { payload = JSON.parse(new URLSearchParams(raw).get("payload") ?? ""); } catch { return c.json({ error: "Bad payload.", code: "bad_request" }, 400); }
  const act = payload.actions?.[0];
  const result = act?.value;
  const runId = act?.block_id?.startsWith("outcome:") ? act.block_id.slice(8) : null;
  if (!runId || (result !== "confirmed" && result !== "denied" && result !== "no_answer")) return c.json({ ok: true });
  const post = await env.DB.prepare("SELECT org_id FROM slack_posts WHERE run_id = ?1").bind(runId).first<{ org_id: string }>();
  if (!post) return c.json({ ok: true });
  const by = payload.user?.name ?? payload.user?.username ?? "Slack user";
  const work = (async () => {
    const r = await logOutcome(env, post.org_id, runId, result, `${by} (Slack)`, null);
    const slack = parseMeta(await getConn(env, post.org_id, "slack"));
    const stored = await env.DB.prepare("SELECT channel, ts FROM slack_posts WHERE run_id = ?1").bind(runId).first<{ channel: string; ts: string }>();
    if (r.ok && slack && stored) {
      const req = await env.DB.prepare("SELECT amount_cents FROM requests WHERE id = ?1").bind(r.run.requestId).first<{ amount_cents: number }>();
      await api(env, slack, "chat.update", { channel: stored.channel, ts: stored.ts, ...runBlocks(r.run, { amountCents: req?.amount_cents ?? null, appUrl: appUrl(env), resolved: outcomeText(result, by) }) });
    }
  })();
  try { c.executionCtx.waitUntil(work); } catch { await work; }
  return c.json({ ok: true });
});
