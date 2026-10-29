// GET /api/sweep/work: what the job screens. Letter text is untrusted and may contain hidden lines; the rails see all of it.
import { extractText, getDocumentProxy } from "unpdf";
import type { OpsEnv } from "./sweep";

export type WorkItem = {
  requestId: string;
  spans: Array<{ source: "letter" | "email"; text: string }>;
  rationale: string | null;
  evidence: Array<{ id: string; label: string; value: string }>;
};
type Row = { id: string; letter_key: string; json: string; latest_run_id: string | null; run_json: string | null };
const LETTER_CHARS = 5000;

async function letterText(env: Pick<OpsEnv, "FILES" | "CACHE">, key: string): Promise<string> {
  const cacheKey = `letter-text:v1:${key}`;
  const hit = await env.CACHE.get(cacheKey);
  if (hit !== null) return hit;
  try {
    const obj = await env.FILES.get(key);
    if (!obj) return "";
    const pdf = await getDocumentProxy(new Uint8Array(await obj.arrayBuffer()));
    const { text } = await extractText(pdf, { mergePages: true });
    const clean = text.replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim().slice(0, LETTER_CHARS);
    await env.CACHE.put(cacheKey, clean, { expirationTtl: 24 * 60 * 60 });
    return clean;
  } catch {
    return "";
  }
}

type RunShape = { decision?: { rationale?: string } | null; evidence?: Array<{ id: string; label: string; value: string }>; letter?: { claims?: Array<{ field: string; value: string }> } | null };

const WORK_SQL = "SELECT r.id, r.letter_key, r.json, r.latest_run_id, u.json AS run_json FROM requests r LEFT JOIN runs u ON u.id = r.latest_run_id WHERE r.status != 'closed'";

/** Open requests with their untrusted text. `orgId` limits it to one company once requests carry an org_id column. */
export async function sweepWork(env: Pick<OpsEnv, "DB" | "FILES" | "CACHE">, orgId?: string): Promise<WorkItem[]> {
  let rows: { results: Row[] };
  try {
    rows = orgId ? await env.DB.prepare(`${WORK_SQL} AND r.org_id = ?1 ORDER BY r.next_run_at, r.received_at`).bind(orgId).all<Row>() : await env.DB.prepare(`${WORK_SQL} ORDER BY r.next_run_at, r.received_at`).all<Row>();
  } catch {
    if (orgId) return [];
    throw new Error("work query failed");
  }
  const items: WorkItem[] = [];
  for (const r of rows.results) {
    const extra = JSON.parse(r.json) as { email?: { from?: string; subject?: string } };
    const text = await letterText(env, r.letter_key);
    const spans: WorkItem["spans"] = [];
    if (text) spans.push({ source: "letter", text });
    if (extra.email?.subject) spans.push({ source: "email", text: `From: ${extra.email.from ?? ""}\nSubject: ${extra.email.subject}` });
    let rationale: string | null = null;
    const evidence: WorkItem["evidence"] = [];
    if (r.run_json) {
      const run = JSON.parse(r.run_json) as RunShape;
      rationale = run.decision?.rationale?.trim() || null;
      for (const e of run.evidence ?? []) evidence.push({ id: e.id, label: e.label, value: e.value });
      for (const c of run.letter?.claims ?? []) evidence.push({ id: `claim-${c.field}`, label: `Claimed in the letter (${c.field})`, value: c.value });
    }
    items.push({ requestId: r.id, spans, rationale, evidence });
  }
  return items;
}
