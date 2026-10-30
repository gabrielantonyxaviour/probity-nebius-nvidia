"use client";
import Link from "next/link";
import { useState } from "react";
import type { Run } from "@probity/shared";
import { api } from "@/lib/api";
import { dateTime, money, until } from "@/lib/format";
import { useData } from "@/lib/use-data";
import { ErrorBox, Skeleton } from "../states";
import { Decide } from "./decide";
import { EvidenceTab } from "./evidence";
import { Progress } from "./progress";
import { StartCheck } from "./start-check";

export function Review({ requestId }: { requestId: string }) {
  const [runId, setRunId] = useState<string | null>(null);
  const [tab, setTab] = useState<"decide" | "evidence">("decide");
  const [focus, setFocus] = useState<string | null>(null);
  const req = useData(() => api.request(requestId), [requestId]);
  const activeRunId = runId ?? req.data?.runId ?? null;
  const run = useData<Run | null>(
    () => (activeRunId ? api.run(activeRunId) : Promise.resolve(null)),
    [activeRunId], 1500, (r) => !!r && (r.status === "running" || r.status === "queued"),
  );
  const r = run.data;

  const showEvidence = (evidenceId: string | null) => {
    setFocus(evidenceId);
    setTab("evidence");
    requestAnimationFrame(() => document.getElementById(evidenceId ?? "evidence-top")?.scrollIntoView({ behavior: "smooth", block: "center" }));
  };

  return (
    <div className="wrap" style={{ paddingTop: 22 }}>
      <Link href="/" className="muted" style={{ textDecoration: "none", fontSize: 14 }}>← Inbox</Link>
      {req.error && <div style={{ marginTop: 16 }}><ErrorBox error={req.error} onRetry={req.reload} /></div>}
      {!req.data && !req.error && <div style={{ marginTop: 16 }} className="stack"><Skeleton h={40} w="60%" /><Skeleton h={18} w="40%" /></div>}
      {req.data && (
        <header style={{ margin: "12px 0 18px" }}>
          <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
            <span className="label">{req.data.kind === "bank_change" ? "New bank account" : "New remit address"}</span>
            <span className="label">· {req.data.requestId}</span>
            {req.data.synthetic && <span className="chip synth" title="The request, the letter and our company's records are synthetic">Synthetic request</span>}
          </div>
          <h1 className="serif" style={{ fontSize: "clamp(28px, 4vw, 40px)", lineHeight: 1.1, margin: "8px 0 8px" }}>{req.data.vendorName}</h1>
          <p className="muted" style={{ margin: 0 }}>
            <b className="num" style={{ color: "var(--fg)" }}>{money(req.data.amountAtRisk)}</b> goes to the new details in the next run
            {req.data.nextRunAt && <> · cut-off {dateTime(req.data.nextRunAt)} ({until(req.data.nextRunAt)} left)</>}
            {" "}· from <span className="mono">{req.data.email.from}</span>
          </p>
        </header>
      )}

      {req.data && !activeRunId && <StartCheck requestId={requestId} onStarted={setRunId} />}
      {activeRunId && run.error && !r && <ErrorBox error={run.error} onRetry={run.reload} />}
      {activeRunId && !r && !run.error && <div className="card pad stack"><Skeleton h={24} w="30%" /><Skeleton h={120} /></div>}
      {r && r.status !== "done" && <Progress run={r} />}
      {r && r.status === "done" && r.decision && (
        <>
          <div role="tablist" aria-label="Review" className="row" style={{ gap: 4, borderBottom: "1px solid var(--rule)", marginBottom: 20 }}>
            <TabButton on={tab === "decide"} onClick={() => setTab("decide")}>Decide</TabButton>
            <TabButton on={tab === "evidence"} onClick={() => showEvidence(null)}>Evidence</TabButton>
            <span style={{ flex: 1 }} />
            <span className="muted" style={{ fontSize: 13, paddingBottom: 8 }}>
              {r.live ? "Checked live" : "Recorded check"} · {r.finishedAt ? dateTime(r.finishedAt) : ""}
            </span>
          </div>
          {tab === "decide" ? (
            <Decide run={r} letterKey={req.data?.letterKey} onEvidence={showEvidence} onChanged={run.reload} />
          ) : (
            <EvidenceTab run={r} focus={focus} />
          )}
        </>
      )}
      {r && r.status === "done" && !r.decision && <ErrorBox error={{ message: r.error ?? "The check finished without a decision. Run it again." }} />}
      {r && r.status === "failed" && (
        <div style={{ marginTop: 16 }}>
          <ErrorBox error={{ message: r.error ?? "The check stopped before it finished." }} />
          <div style={{ marginTop: 12 }}><StartCheck requestId={requestId} onStarted={setRunId} again /></div>
        </div>
      )}
    </div>
  );
}

function TabButton({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button role="tab" aria-selected={on} onClick={onClick}
      style={{ background: "none", border: 0, padding: "10px 14px", cursor: "pointer", fontSize: 15, fontWeight: on ? 600 : 400,
        color: on ? "var(--fg)" : "var(--muted)", borderBottom: `2px solid ${on ? "var(--fg)" : "transparent"}`, marginBottom: -1 }}>
      {children}
    </button>
  );
}
