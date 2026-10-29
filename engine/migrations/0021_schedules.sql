-- Per-company payment-run schedule and the pre-run re-check bookkeeping (Sonnet B).
CREATE TABLE IF NOT EXISTS schedules (
  org_id TEXT PRIMARY KEY,
  timezone TEXT NOT NULL,
  runs_json TEXT NOT NULL,           -- [{weekday, cutoff}]
  recheck_minutes_before INTEGER NOT NULL,
  notify_emails_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  next_recheck_at TEXT,              -- UTC ISO, computed on save and after each re-check
  last_recheck_at TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_schedules_due ON schedules(enabled, next_recheck_at);
