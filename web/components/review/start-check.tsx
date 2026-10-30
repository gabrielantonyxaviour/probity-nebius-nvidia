"use client";
import { useState } from "react";
import { api, ApiFailure } from "@/lib/api";
import { useData } from "@/lib/use-data";

const CAP_MESSAGE: Record<string, string> = {
  cap_reached: "Today's live checks are used up. Recorded checks stay open to everyone; live checks reset at midnight UTC.",
  session_cap: "You've used your three live checks. The recorded checks in the inbox are free to open.",
  stopped: "Live checks are paused. Recorded checks stay open.",
};

export function StartCheck({ requestId, onStarted, again = false }: { requestId: string; onStarted: (runId: string) => void; again?: boolean }) {
  const limits = useData(() => api.limits(), []);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const l = limits.data;
  const blocked = !!l && (l.stopped || l.liveChecksLeftToday <= 0 || l.sessionChecksLeft <= 0);

  async function start() {
    setBusy(true);
    setError(null);
    try {
      const { runId } = await api.startCheck(requestId);
      onStarted(runId);
    } catch (e) {
      setError(e instanceof ApiFailure ? CAP_MESSAGE[e.code ?? ""] ?? e.message : "Couldn't start the check. Try again.");
      setBusy(false);
    }
  }

  return (
    <section className="card" style={{ padding: "24px 24px", display: "grid", gap: 14, maxWidth: 720 }}>
      <div>
        <p className="label" style={{ margin: 0 }}>{again ? "Run it again" : "Not checked yet"}</p>
        <p className="serif" style={{ fontSize: 26, margin: "6px 0 6px", lineHeight: 1.2 }}>Check this request before the payment run.</p>
        <p className="muted" style={{ margin: 0 }}>
          Probity reads the letter and checks the PDF for text a person can't see, screens every line for instructions aimed at an AI, looks the vendor up in SEC EDGAR, USAspending, GLEIF and on the vendor&apos;s own website, then applies the payment policy. One to three minutes.
        </p>
      </div>
      <div className="row" style={{ flexWrap: "wrap", gap: 12 }}>
        <button className="btn primary" onClick={start} disabled={busy || blocked}>{busy ? "Starting…" : "Check it now"}</button>
        {l && !blocked && (
          <span className="muted" style={{ fontSize: 13.5 }}>
            Live on NVIDIA Nemotron · {l.sessionChecksLeft} of 3 live checks left for you, {l.liveChecksLeftToday} left today
          </span>
        )}
      </div>
      {blocked && l && <p style={{ margin: 0, color: "var(--callback)" }}>{CAP_MESSAGE[l.stopped ? "stopped" : l.sessionChecksLeft <= 0 ? "session_cap" : "cap_reached"]}</p>}
      {error && <p role="alert" style={{ margin: 0, color: "var(--hold)" }}>{error}</p>}
    </section>
  );
}
