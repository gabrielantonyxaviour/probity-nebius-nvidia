-- Integrations (Sonnet B): per-company connections, connect attempts, intake idempotency and counters, Slack posts.
CREATE TABLE IF NOT EXISTS connections (
  org_id TEXT NOT NULL,
  provider TEXT NOT NULL,            -- gmail | outlook | xero | slack
  status TEXT NOT NULL,              -- pending | connected | error
  account TEXT,                      -- ap@acme.com, "Demo Company (US)", #ap-payments
  detail TEXT,                       -- last error or note
  connected_account_id TEXT,         -- Composio connected account (gmail, outlook, xero)
  trigger_id TEXT,                   -- Composio trigger instance (gmail, outlook)
  meta TEXT,                         -- JSON: xero tenant id, slack team/channel/sealed bot token
  connected_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (org_id, provider)
);

CREATE TABLE IF NOT EXISTS connection_attempts (
  id TEXT PRIMARY KEY,               -- random; carried through the callback URL
  org_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  user_id TEXT,
  connected_account_id TEXT,         -- what Composio returned at link time; the callback must match it
  created_at TEXT NOT NULL
);

-- One row per mailbox message seen, so a re-delivered webhook is a no-op. Holds ids only, never mail content.
CREATE TABLE IF NOT EXISTS inbound_messages (
  org_id TEXT NOT NULL,
  message_id TEXT NOT NULL,
  outcome TEXT NOT NULL,             -- ignored | queued | intake | failed
  created_at TEXT NOT NULL,
  PRIMARY KEY (org_id, message_id)
);

CREATE TABLE IF NOT EXISTS intake_counters (
  org_id TEXT NOT NULL,
  day TEXT NOT NULL,
  seen INTEGER NOT NULL DEFAULT 0,
  matched INTEGER NOT NULL DEFAULT 0,
  ignored INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (org_id, day)
);

CREATE TABLE IF NOT EXISTS slack_posts (
  run_id TEXT PRIMARY KEY,
  org_id TEXT NOT NULL,
  request_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  ts TEXT NOT NULL,
  created_at TEXT NOT NULL
);
