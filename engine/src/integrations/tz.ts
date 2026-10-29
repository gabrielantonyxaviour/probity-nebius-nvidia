// Time zone arithmetic for payment-run schedules, with Intl only (no library): local wall time <-> UTC, DST-safe.
import type { Schedule } from "@probity/shared";

type Parts = { year: number; month: number; day: number; hour: number; minute: number; weekday: number };
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function validTimezone(tz: string): boolean {
  try { new Intl.DateTimeFormat("en-US", { timeZone: tz }); return true; } catch { return false; }
}

export function localParts(ms: number, tz: string): Parts {
  const f = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", weekday: "short" });
  const p = Object.fromEntries(f.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
  return { year: Number(p.year), month: Number(p.month), day: Number(p.day), hour: Number(p.hour) % 24, minute: Number(p.minute), weekday: WEEKDAYS.indexOf(String(p.weekday)) };
}

/** UTC instant (ms) of a wall-clock time in a zone. Two passes settle the offset across a DST change. */
export function zonedToUtc(y: number, mo: number, d: number, h: number, mi: number, tz: string): number {
  let guess = Date.UTC(y, mo - 1, d, h, mi);
  for (let i = 0; i < 2; i++) {
    const l = localParts(guess, tz);
    const shown = Date.UTC(l.year, l.month - 1, l.day, l.hour, l.minute);
    guess -= shown - Date.UTC(y, mo - 1, d, h, mi);
  }
  return guess;
}

/** The next moment a final re-check is due: `recheckMinutesBefore` ahead of the next payment-run cut-off after `after`. null when there are no runs. */
export function nextRecheckAt(s: Pick<Schedule, "timezone" | "runs" | "recheckMinutesBefore">, after = Date.now()): string | null {
  let best: number | null = null;
  const base = localParts(after, s.timezone);
  for (let add = 0; add <= 14; add++) {
    const day = new Date(Date.UTC(base.year, base.month - 1, base.day + add));
    const weekday = day.getUTCDay();
    for (const r of s.runs) {
      if (r.weekday !== weekday) continue;
      const [h, m] = r.cutoff.split(":").map(Number);
      const cutoff = zonedToUtc(day.getUTCFullYear(), day.getUTCMonth() + 1, day.getUTCDate(), h ?? 0, m ?? 0, s.timezone);
      const at = cutoff - s.recheckMinutesBefore * 60_000;
      if (at > after && (best === null || at < best)) best = at;
    }
  }
  return best === null ? null : new Date(best).toISOString();
}

/** The cut-off that the re-check at `recheckAt` belongs to, for wording ("Friday's run, cut-off 14:00"). */
export function cutoffAfter(s: Pick<Schedule, "timezone" | "runs">, recheckAt: number): { weekday: string; cutoff: string } | null {
  const l = localParts(recheckAt, s.timezone);
  const names = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  for (let add = 0; add <= 2; add++) {
    const wd = (l.weekday + add) % 7;
    const run = s.runs.filter((r) => r.weekday === wd).sort((a, b) => a.cutoff.localeCompare(b.cutoff))[0];
    if (run) return { weekday: names[wd] ?? "", cutoff: run.cutoff };
  }
  return null;
}
