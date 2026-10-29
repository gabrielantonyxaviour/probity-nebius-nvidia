-- Billing: monthly check usage per company and a log of processed Dodo webhook deliveries (deduplicated by webhook-id).
CREATE TABLE IF NOT EXISTS check_usage (
  org_id TEXT NOT NULL,
  month TEXT NOT NULL,                          -- YYYY-MM (UTC)
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, month)
);

CREATE TABLE IF NOT EXISTS billing_events (
  webhook_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  org_id TEXT,
  applied INTEGER NOT NULL DEFAULT 0,
  received_at TEXT NOT NULL
);
