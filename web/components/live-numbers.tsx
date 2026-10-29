"use client";
import { api } from "@/lib/api";
import { useData } from "@/lib/use-data";
import { Skeleton } from "./states";
import { SweepCard } from "./sweep-card";

/** Measured numbers only: the latest NeMo eval over the labelled test letters, and today's usage. */
export function LiveNumbers() {
  const sweep = useData(() => api.sweep(), []);
  const limits = useData(() => api.limits(), []);
  const ev = sweep.data?.eval ?? null;
  const l = limits.data;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

  return (
    <div style={{ display: "grid", gap: 14 }}>
      <SweepCard sweep={sweep.data ?? null} />
      <div className="card pad" style={{ display: "grid", gap: 10 }}>
        <p className="label" style={{ margin: 0 }}>Measured on our test letters</p>
        {sweep.loading && !sweep.data ? <Skeleton h={48} /> : ev ? (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
            <Stat big={pct(ev.caught, ev.injected)} small={`caught: ${ev.caught} of ${ev.injected} letters with hidden instructions`} />
            <Stat big={pct(ev.falseAlarms, ev.clean)} small={`false alarms: ${ev.falseAlarms} of ${ev.clean} clean letters`} />
          </div>
        ) : (
          <p className="muted" style={{ margin: 0 }}>The evaluation run hasn&apos;t reported yet. These numbers appear once it has; they are never estimated.</p>
        )}
      </div>
      <div className="card pad" style={{ display: "grid", gap: 6 }}>
        <p className="label" style={{ margin: 0 }}>Today</p>
        {l ? (
          <p style={{ margin: 0 }}>
            {l.liveChecksLeftToday} of {l.liveChecksPerDay} live checks left · {l.tavilyCreditsUsed} of {l.tavilyBudget} web-lookup credits used this month
            {l.stopped && <b style={{ color: "var(--callback)" }}> · live checks paused</b>}
          </p>
        ) : <Skeleton h={20} />}
      </div>
    </div>
  );
}

function Stat({ big, small }: { big: string; small: string }) {
  return (
    <div>
      <div className="serif num" style={{ fontSize: 40, lineHeight: 1 }}>{big}</div>
      <div className="muted" style={{ fontSize: 13, marginTop: 4 }}>{small}</div>
    </div>
  );
}
