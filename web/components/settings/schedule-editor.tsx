"use client";
import { useEffect, useState } from "react";
import type { Schedule } from "@probity/shared";
import { account, ApiFailure } from "@/lib/api";
import { dateTime } from "@/lib/format";
import { useData } from "@/lib/use-data";
import { ErrorBox, Skeleton } from "../states";
import { Select } from "../ui/select";
import { TimeSelect } from "../ui/time-select";
import { FormField, Input } from "../ui/input";

const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const DAY_OPTIONS = DAYS.map((d, n) => ({ value: n, label: d }));
const LEAD = [[30, "30 minutes"], [60, "1 hour"], [120, "2 hours"], [240, "4 hours"], [1440, "1 day"]] as const;
const ZONES = ["America/New_York", "America/Chicago", "America/Denver", "America/Los_Angeles", "Europe/London", "Europe/Berlin", "Asia/Singapore", "Asia/Kuala_Lumpur", "Australia/Sydney", "UTC"];
type Draft = Omit<Schedule, "nextRecheckAt">;

/** The company's payment runs: Probity re-checks every open request this long before each cut-off. */
export function ScheduleEditor({ canEdit }: { canEdit: boolean }) {
  const s = useData(() => account.schedule(), []);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [emails, setEmails] = useState("");
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!s.data || draft) return;
    const { nextRecheckAt: _n, ...rest } = s.data;
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setDraft(rest.runs.length ? rest : { ...rest, timezone: rest.timezone || tz, runs: [{ weekday: 2, cutoff: "14:00" }, { weekday: 5, cutoff: "14:00" }] });
    setEmails(rest.notifyEmails.join(", "));
  }, [s.data, draft]);

  if (s.error) return <ErrorBox error={s.error} onRetry={s.reload} />;
  if (!draft) return <div className="stack"><Skeleton h={44} /><Skeleton h={44} /></div>;
  const edit = canEdit;
  const set = (patch: Partial<Draft>) => setDraft({ ...draft, ...patch });

  async function save() {
    const list = emails.split(/[,\s]+/).map((e) => e.trim()).filter(Boolean);
    if (list.some((e) => !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(e))) return setMsg({ ok: false, text: "One of the e-mail addresses doesn't look right." });
    setSaving(true); setMsg(null);
    try {
      const saved = await account.saveSchedule({ ...draft!, notifyEmails: list });
      setMsg({ ok: true, text: saved.nextRecheckAt ? `Saved. Next re-check ${dateTime(saved.nextRecheckAt)}.` : "Saved." });
      s.reload();
    } catch (e) {
      setMsg({ ok: false, text: e instanceof ApiFailure ? e.message : "Couldn't save. Try again." });
    } finally { setSaving(false); }
  }

  return (
    <div style={{ display: "grid", gap: 18 }}>
      <p className="muted" style={{ margin: 0 }}>
        Requests are checked the moment they arrive. Before each payment run, Probity checks every open request again, because registry facts change and fraudsters send follow-ups. Your team gets the summary in Slack and by e-mail.
      </p>
      <fieldset disabled={!edit} style={{ border: 0, padding: 0, margin: 0, display: "grid", gap: 16, opacity: edit ? 1 : 0.6 }}>
        <FormField label="Time zone of your cut-offs" htmlFor="sched-tz" style={{ maxWidth: 360 }}>
          <Select id="sched-tz" value={draft.timezone} disabled={!edit} onChange={(v) => set({ timezone: v })}
            options={[...new Set([draft.timezone, ...ZONES])].map((z) => ({ value: z, label: z.replace(/_/g, " ") }))} />
        </FormField>
        <div className="ui-field">
          <span className="ui-field-label" id="sched-runs">Payment runs</span>
          <div style={{ display: "grid", gap: 8 }} role="group" aria-labelledby="sched-runs">
            {draft.runs.map((r, i) => (
              <div key={i} className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                <Select width={170} value={r.weekday} options={DAY_OPTIONS} aria-label="Day" disabled={!edit}
                  onChange={(v) => set({ runs: draft.runs.map((x, j) => j === i ? { ...x, weekday: v } : x) })} />
                <span className="muted" style={{ fontSize: 14 }}>cut-off</span>
                <TimeSelect width={130} value={r.cutoff} aria-label="Cut-off time" disabled={!edit}
                  onChange={(v) => set({ runs: draft.runs.map((x, j) => j === i ? { ...x, cutoff: v } : x) })} />
                <button type="button" className="btn" style={{ minHeight: 40 }} onClick={() => set({ runs: draft.runs.filter((_, j) => j !== i) })} aria-label="Remove this run">Remove</button>
              </div>
            ))}
            {draft.runs.length < 14 && <button type="button" className="linkish" style={{ justifySelf: "start" }} onClick={() => set({ runs: [...draft.runs, { weekday: 1, cutoff: "14:00" }] })}>Add a payment run</button>}
          </div>
        </div>
        <FormField label="Re-check before each cut-off" htmlFor="sched-lead" style={{ maxWidth: 360 }}>
          <Select id="sched-lead" value={draft.recheckMinutesBefore} disabled={!edit} onChange={(v) => set({ recheckMinutesBefore: v })}
            options={LEAD.map(([m, l]) => ({ value: m as number, label: `${l} before` }))} />
        </FormField>
        <FormField label="Send the pre-run summary to" htmlFor="sched-emails" hint="Separate addresses with commas. Slack gets it too when it's connected." style={{ maxWidth: 560 }}>
          <Input id="sched-emails" value={emails} onChange={(e) => setEmails(e.target.value)} placeholder="controller@yourcompany.com, ap@yourcompany.com" />
        </FormField>
      </fieldset>
      {edit && (
        <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
          <button className="btn primary" onClick={save} disabled={saving}>{saving ? "Saving…" : "Save schedule"}</button>
          {msg && <span role="status" style={{ color: msg.ok ? "var(--approve)" : "var(--hold)" }}>{msg.text}</span>}
        </div>
      )}
      {s.data?.nextRecheckAt && !msg && <p className="muted" style={{ margin: 0 }}>Next re-check: {dateTime(s.data.nextRecheckAt)}</p>}
    </div>
  );
}
