// Payment-run schedule per company (GET/PUT /schedule) and the pre-run re-check that runs ahead of each cut-off.
import { Hono } from "hono";
import { z } from "zod";
import { DEMO_ORG_ID, PaymentRun, Run, Schedule } from "@probity/shared";
import { getPlan } from "../billing/plans";
import { startRun } from "../check/start";
import { lookupEdgar, lookupGleif, lookupUsaspending } from "../evidence";
import { sendEmail, preRunSummaryEmail } from "../email";
import { railsPass } from "../ops/rails";
import { recordSpend } from "../ops/spend";
import { storeCallback } from "../ops/sweep";
import { sweepWork, type WorkItem } from "../ops/work";
import type { AppEnv } from "../routes/util";
import { requireAdmin } from "./access";
import { appUrl, nowIso, type IntEnv } from "./env";
import { postSummary } from "./slack";
import { getConn } from "./store";
import { cutoffAfter, nextRecheckAt, validTimezone } from "./tz";
import { syncXero } from "./xero";

export const scheduleRoutes = new Hono<AppEnv>();

const Input = z.object({ timezone: z.string().refine(validTimezone, "Unknown time zone"), runs: z.array(PaymentRun).max(14), recheckMinutesBefore: z.number().int().min(15).max(1440), notifyEmails: z.array(z.string().email()).max(10) });
const DEFAULT = { timezone: "America/New_York", runs: [{ weekday: 2, cutoff: "14:00" }, { weekday: 5, cutoff: "14:00" }], recheckMinutesBefore: 120, notifyEmails: [] as string[] };

type Row = { timezone: string; runs_json: string; recheck_minutes_before: number; notify_emails_json: string; enabled: number; next_recheck_at: string | null };
const parseJson = <T,>(t: string, fallback: T): T => { try { return JSON.parse(t) as T; } catch { return fallback; } };

async function load(env: IntEnv, orgId: string): Promise<Schedule> {
  const r = await env.DB.prepare("SELECT timezone, runs_json, recheck_minutes_before, notify_emails_json, enabled, next_recheck_at FROM schedules WHERE org_id = ?1").bind(orgId).first<Row>();
  if (!r) return { ...DEFAULT, nextRecheckAt: null };
  return { timezone: r.timezone, runs: parseJson(r.runs_json, []), recheckMinutesBefore: r.recheck_minutes_before, notifyEmails: parseJson(r.notify_emails_json, []), nextRecheckAt: r.enabled ? r.next_recheck_at : null };
}

scheduleRoutes.get("/schedule", async (c) => c.json(await load(c.env, c.get("orgId"))));

scheduleRoutes.put("/schedule", requireAdmin, async (c) => {
  const orgId = c.get("orgId");
  if ((await getPlan(c.env, orgId)) !== "pro") return c.json({ error: "Scheduled pre-run re-checks are part of the Pro plan.", code: "pro_required" }, 402);
  const body = Input.safeParse(await c.req.json().catch(() => null));
  if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? "That schedule is not valid.", code: "bad_request" }, 400);
  const next = nextRecheckAt(body.data);
  await c.env.DB.prepare("INSERT INTO schedules (org_id, timezone, runs_json, recheck_minutes_before, notify_emails_json, enabled, next_recheck_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(org_id) DO UPDATE SET timezone=excluded.timezone, runs_json=excluded.runs_json, recheck_minutes_before=excluded.recheck_minutes_before, notify_emails_json=excluded.notify_emails_json, enabled=excluded.enabled, next_recheck_at=excluded.next_recheck_at, updated_at=excluded.updated_at")
    .bind(orgId, body.data.timezone, JSON.stringify(body.data.runs), body.data.recheckMinutesBefore, JSON.stringify(body.data.notifyEmails), body.data.runs.length > 0 ? 1 : 0, next, nowIso()).run();
  return c.json(await load(c.env, orgId));
});

// ---- the re-check ----

type EvidenceFact = { source: string; field: string; value: string };
const REG = { sec_edgar: lookupEdgar, usaspending: lookupUsaspending, gleif: lookupGleif } as const;

/** Re-reads the public registries for the vendors of open, already-checked requests; returns the request ids whose facts changed since their last check. */
export async function changedRequests(env: IntEnv, orgId: string, items: WorkItem[], limit = 20): Promise<string[]> {
  const changed: string[] = [];
  const rows = await env.DB.prepare("SELECT r.id, v.legal_name, v.uei, u.json AS run_json FROM requests r JOIN vendors v ON v.vendor_id = r.vendor_id JOIN runs u ON u.id = r.latest_run_id WHERE r.org_id = ?1 AND r.status != 'closed' AND u.status = 'done'").bind(orgId).all<{ id: string; legal_name: string; uei: string | null; run_json: string }>();
  const open = new Set(items.map((i) => i.requestId));
  for (const r of rows.results.filter((x) => open.has(x.id)).slice(0, limit)) {
    const run = Run.safeParse(JSON.parse(r.run_json));
    if (!run.success) continue;
    const before: EvidenceFact[] = run.data.evidence.filter((e) => e.source in REG).map((e) => ({ source: e.source, field: e.field, value: e.value }));
    const sources = [...new Set(before.map((b) => b.source))] as Array<keyof typeof REG>;
    for (const src of sources) {
      const call = src === "sec_edgar" ? await lookupEdgar(env, { name: r.legal_name }, { fresh: true }) : src === "usaspending" ? await lookupUsaspending(env, { name: r.legal_name, ...(r.uei ? { uei: r.uei } : {}) }, { fresh: true }) : await lookupGleif(env, { name: r.legal_name }, { fresh: true });
      if (call.evidence.length === 0) continue; // source unavailable today: no evidence of change
      const was = new Set(before.filter((b) => b.source === src && ["phone", "address", "legal_name", "domain"].includes(b.field)).map((b) => `${b.field}|${b.value}`));
      const now = new Set(call.evidence.filter((e) => ["phone", "address", "legal_name", "domain"].includes(e.field)).map((e) => `${e.field}|${e.value}`));
      if ([...now].some((x) => !was.has(x)) || [...was].some((x) => !now.has(x))) { changed.push(r.id); break; }
    }
  }
  return changed;
}

type Due = { org_id: string; timezone: string; runs_json: string; recheck_minutes_before: number; notify_emails_json: string; next_recheck_at: string };

export async function runOneRecheck(env: IntEnv, d: Due, now: number): Promise<void> {
  const orgId = d.org_id;
  const sched = { timezone: d.timezone, runs: parseJson<Schedule["runs"]>(d.runs_json, []), recheckMinutesBefore: d.recheck_minutes_before };
  const startedAt = nowIso();
  if (await getConn(env, orgId, "xero")) await syncXero(env, orgId, { force: true });
  const items = await sweepWork(env, orgId);
  const changed = await changedRequests(env, orgId, items);
  const rechecked: string[] = [];
  for (const id of changed) {
    const v = await env.DB.prepare("SELECT v.legal_name AS name FROM requests r JOIN vendors v ON v.vendor_id = r.vendor_id WHERE r.id = ?1").bind(id).first<{ name: string }>();
    const started = await startRun(env, `recheck-${orgId}`, orgId, id, v?.name ?? id);
    if (started.ok) rechecked.push(id);
  }
  const rails = await railsPass(env, items);
  const counts = await env.DB.prepare("SELECT json_extract(u.json, '$.decision.finalVerdict') AS verdict, COUNT(*) AS n FROM requests r JOIN runs u ON u.id = r.latest_run_id WHERE r.org_id = ?1 AND r.status != 'closed' GROUP BY 1").bind(orgId).all<{ verdict: string | null; n: number }>();
  const n = (v: string): number => counts.results.find((x) => x.verdict === v)?.n ?? 0;
  await storeCallback(env, { sweepId: `recheck-${crypto.randomUUID().slice(0, 8)}`, mode: "sweep", state: "completed", startedAt, finishedAt: nowIso(), requestsSwept: rails.requestsSwept, recheckedRequestIds: rechecked, flaggedRequestIds: rails.flaggedRequestIds, sweptRequestIds: rails.sweptRequestIds, nemo: rails.nemo, eval: null, costUsd: rails.costUsd, tokenCostUsd: 0 }, { nebiusJob: false });
  await recordSpend(env, [{ kind: "token_factory", usd: rails.costUsd, orgId, note: "pre-run re-check rails" }]).catch(() => undefined);
  const when = cutoffAfter(sched, now);
  const sum = { cleared: n("APPROVE"), onHold: n("HOLD"), needsCall: n("CALLBACK_VERIFY") };
  const org = await env.DB.prepare("SELECT name FROM organization WHERE id = ?1").bind(orgId).first<{ name: string }>();
  await postSummary(env, orgId, { company: org?.name ?? "Your company", weekday: when?.weekday ?? null, cutoff: when?.cutoff ?? null, ...sum, flagged: rails.flaggedRequestIds.length });
  const to = parseJson<string[]>(d.notify_emails_json, []);
  if (to.length > 0 && when) await sendEmail(env, { to, ...preRunSummaryEmail({ company: org?.name, weekday: when.weekday, cutoff: when.cutoff, ...sum, link: `${appUrl(env)}/` }) });
}

/** Cron entry (every 5 minutes): re-checks every company whose final pre-run window has opened, then schedules its next one. */
export async function runDueRechecks(env: IntEnv, now = Date.now()): Promise<{ ran: string[]; failed: string[] }> {
  const due = await env.DB.prepare("SELECT org_id, timezone, runs_json, recheck_minutes_before, notify_emails_json, next_recheck_at FROM schedules WHERE enabled = 1 AND next_recheck_at IS NOT NULL AND next_recheck_at <= ?1 AND org_id != ?2 LIMIT 20").bind(new Date(now).toISOString(), DEMO_ORG_ID).all<Due>();
  const out = { ran: [] as string[], failed: [] as string[] };
  for (const d of due.results) {
    const next = nextRecheckAt({ timezone: d.timezone, runs: parseJson(d.runs_json, []), recheckMinutesBefore: d.recheck_minutes_before }, now);
    // Claim the window with a compare-and-set that also moves it on: only one cron run (or a retried one) wins, and a crash cannot
    // make the same window fire every five minutes.
    const claim = await env.DB.prepare("UPDATE schedules SET next_recheck_at = ?2, last_recheck_at = ?3 WHERE org_id = ?1 AND next_recheck_at = ?4").bind(d.org_id, next, new Date(now).toISOString(), d.next_recheck_at).run();
    if ((claim.meta.changes ?? 0) === 0) continue;
    if ((await getPlan(env, d.org_id)) !== "pro") continue;
    try { await runOneRecheck(env, d, now); out.ran.push(d.org_id); } catch { out.failed.push(d.org_id); }
  }
  return out;
}
