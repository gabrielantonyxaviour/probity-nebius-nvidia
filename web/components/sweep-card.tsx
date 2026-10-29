import type { SweepReport } from "@probity/shared";
import { dateTime, dollars, seconds, time } from "@/lib/format";

/** The pre-run re-check: NVIDIA NeMo Guardrails rails over every open request, on a Nebius job or in the app. */
export function SweepCard({ sweep, compact = false }: { sweep: SweepReport | null; compact?: boolean }) {
  if (!sweep) {
    return (
      <div className="card pad">
        <p className="label" style={{ margin: 0 }}>Pre-run re-check</p>
        <p style={{ margin: "6px 0 0" }} className="muted">No re-check has run yet. Before each payment run, Probity checks every open request again.</p>
      </div>
    );
  }
  const ran = sweep.finishedAt ? new Date(sweep.finishedAt).getTime() - new Date(sweep.startedAt).getTime() : null;
  return (
    <div className="card pad" style={{ display: "grid", gap: 10 }}>
      <div className="between">
        <p className="label" style={{ margin: 0 }}>Pre-run re-check</p>
        <span className={`chip ${sweep.state === "completed" ? "info" : sweep.state === "failed" ? "hold" : ""}`}>
          {sweep.state === "running" || sweep.state === "starting" ? <span className="pulse">● {sweep.state}</span> : sweep.state}
        </span>
      </div>
      <p style={{ margin: 0 }}>
        {sweep.finishedAt ? `Re-checked ${sweep.requestsSwept} open requests at ${time(sweep.finishedAt)}` : `Started ${dateTime(sweep.startedAt)}`}
        <span className="muted">{sweep.jobId.startsWith("aijob-") ? " on a Nebius AI Cloud Serverless Job." : " before the payment run."}</span>
      </p>
      <p style={{ margin: 0, fontSize: 14 }}>
        NVIDIA NeMo Guardrails rails screened <b className="num">{sweep.nemo.spansChecked}</b> lines from letters, e-mails and web pages, and flagged{" "}
        <b className="num" style={{ color: sweep.nemo.flagged ? "var(--hold)" : undefined }}>{sweep.nemo.flagged}</b>.
        {sweep.recheckedRequestIds.length > 0 && ` Registry facts changed for ${sweep.recheckedRequestIds.length}, so ${sweep.recheckedRequestIds.length === 1 ? "it was" : "they were"} checked again.`}
      </p>
      {!compact && (
        <p className="mono muted" style={{ margin: 0, fontSize: 12, wordBreak: "break-all" }}>
          {sweep.jobId}{ran !== null && ` · ${seconds(ran)}`} · {dollars(sweep.costUsd)}
        </p>
      )}
    </div>
  );
}
