import type { Verdict } from "@probity/shared";
import { VERDICT } from "@/lib/format";

const GLYPH: Record<Verdict, string> = { APPROVE: "✓", CALLBACK_VERIFY: "☏", HOLD: "✕" };

export function VerdictChip({ verdict, size = "sm" }: { verdict: Verdict | null; size?: "sm" | "lg" }) {
  if (!verdict) return <span className="chip" style={{ color: "var(--muted)" }}>Not checked</span>;
  const v = VERDICT[verdict];
  const lg = size === "lg";
  return (
    <span className={`chip ${v.chip}`} style={lg ? { fontSize: 13, padding: "4px 12px" } : undefined}>
      <span aria-hidden="true">{GLYPH[verdict]}</span>
      {v.word}
    </span>
  );
}

export function verdictColor(verdict: Verdict) {
  return verdict === "APPROVE" ? "approve" : verdict === "HOLD" ? "hold" : "callback";
}
