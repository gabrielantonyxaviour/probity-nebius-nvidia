// Development-only mock of the engine API (PROBITY_MOCK=1). A started check progresses over ~24 s so the
// running state can be designed against something that moves.
import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Limits, Run, SweepReport } from "@probity/shared";
import { fixtureSteps, inbox, sampleCalls } from "./data";
import { runs } from "./runs";

const started = new Map<string, { at: number; template: string; requestId: string }>();
const outcomes = new Map<string, Run["decision"]>();

const limits: Limits = { liveChecksLeftToday: 7, liveChecksPerDay: 10, sessionChecksLeft: 3, tavilyCreditsUsed: 18, tavilyBudget: 150, stopped: false };
const sweep: SweepReport = {
  jobId: "aijob-e04m0sweep0demo0001", state: "completed", startedAt: "2026-10-29T18:00:41Z", finishedAt: "2026-10-29T18:04:12Z",
  requestsSwept: 5, recheckedRequestIds: ["BCR-2026-0412"],
  nemo: { spansChecked: 186, flagged: 4, outputChecks: 3, outputBlocked: 0 }, eval: null, costUsd: 0.011,
};

function progressed(runId: string): Run | null {
  const s = started.get(runId);
  if (!s) return null;
  const done = runs[s.template];
  const elapsed = (Date.now() - s.at) / 1000;
  const steps = fixtureSteps(false).map((st, i) => {
    const t0 = i * 3, t1 = t0 + 3;
    const status = elapsed >= t1 ? "done" : elapsed >= t0 ? "running" : "pending";
    return { ...st, status, startedAt: elapsed >= t0 ? new Date(s.at + t0 * 1000).toISOString() : null, finishedAt: elapsed >= t1 ? new Date(s.at + t1 * 1000).toISOString() : null } as Run["steps"][number];
  });
  const finished = steps.every((x) => x.status === "done");
  const doneKeys = new Set(steps.filter((x) => x.status === "done").map((x) => x.key));
  return {
    ...done, id: runId, requestId: s.requestId, live: true, status: finished ? "done" : "running",
    startedAt: new Date(s.at).toISOString(), finishedAt: finished ? new Date(s.at + 24000).toISOString() : null,
    steps, calls: sampleCalls().filter((c) => doneKeys.has(c.stepKey)),
    letter: doneKeys.has("read_image") ? done.letter : null, screen: doneKeys.has("screen") ? done.screen : null,
    evidence: doneKeys.has("scout") ? done.evidence : [], decision: finished ? outcomes.get(runId) ?? done.decision : null,
  };
}

function withOutcome(run: Run): Run {
  const d = outcomes.get(run.id);
  return d ? { ...run, decision: d } : run;
}

export async function mockResponse(req: Request, target: string): Promise<Response> {
  const url = new URL(target, "http://x");
  const p = url.pathname;
  await new Promise((r) => setTimeout(r, 250));

  if (p === "/api/inbox") return Response.json(inbox);
  if (p === "/api/limits") return Response.json(limits);
  if (p === "/api/sweep/latest") return Response.json(sweep);
  if (p.startsWith("/api/files/dev/")) {
    const file = path.join(process.cwd(), "dev-fixtures", path.basename(p));
    return new Response(await readFile(file), { headers: { "content-type": "image/png" } });
  }
  const req1 = p.match(/^\/api\/requests\/([\w-]+)$/);
  if (req1) {
    const item = inbox.find((i) => i.requestId === req1[1]);
    if (!item) return Response.json({ error: "No such request", code: "not_found" }, { status: 404 });
    return Response.json({
      ...item, letterKey: "dev/letter.pdf",
      email: { from: item.senderEmail, replyTo: null, subject: "Updated payment instructions", received: item.receivedAt, spf: "pass", dkim: "pass" },
      vendorOnFile: { legalName: item.vendorName, remitAddress: "On file", phone: null, domain: null, accountMasked: "••••2208" },
    });
  }
  if (p === "/api/checks" && req.method === "POST") {
    const { requestId } = (await req.json()) as { requestId: string };
    const template = inbox.find((i) => i.requestId === requestId)?.runId ?? "run-booz";
    const runId = `run-live-${Date.now().toString(36)}`;
    started.set(runId, { at: Date.now(), template, requestId });
    const item = inbox.find((i) => i.requestId === requestId);
    if (item) { item.runId = runId; item.status = "checking"; }
    limits.liveChecksLeftToday -= 1; limits.sessionChecksLeft -= 1;
    return Response.json({ runId });
  }
  const out = p.match(/^\/api\/runs\/([\w-]+)\/outcome$/);
  if (out && req.method === "POST") {
    const { result } = (await req.json()) as { result: "confirmed" | "denied" | "no_answer" };
    const run = progressed(out[1]) ?? runs[out[1]];
    if (!run?.decision) return Response.json({ error: "Nothing to log yet", code: "not_ready" }, { status: 409 });
    const v = run.decision.verdict;
    const finalVerdict = v === "HOLD" ? "HOLD" : result === "confirmed" ? "APPROVE" : result === "denied" ? "HOLD" : v;
    const decision = { ...run.decision, finalVerdict, outcome: { result, by: "AP clerk", at: new Date().toISOString(), note: null } } as Run["decision"];
    outcomes.set(out[1], decision);
    const item = inbox.find((i) => i.runId === out[1]);
    if (item) { item.outcome = result; item.verdict = finalVerdict; item.status = "closed"; }
    return Response.json({ ...run, decision });
  }
  const r = p.match(/^\/api\/runs\/([\w-]+)$/);
  if (r) {
    const run = progressed(r[1]) ?? runs[r[1]];
    if (!run) return Response.json({ error: "No such check", code: "not_found" }, { status: 404 });
    const item = inbox.find((i) => i.runId === r[1]);
    if (item && run.status === "done" && item.status === "checking") { item.status = "checked"; item.verdict = run.decision?.verdict ?? null; }
    return Response.json(withOutcome(run));
  }
  return Response.json({ error: "Not found", code: "not_found" }, { status: 404 });
}
