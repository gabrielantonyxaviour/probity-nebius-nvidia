-- Mail that was not sent through Resend (no verified sending domain yet, or the send failed). Read it in local development.
CREATE TABLE IF NOT EXISTS email_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  to_addr TEXT NOT NULL,
  subject TEXT NOT NULL,
  text TEXT NOT NULL,
  html TEXT,
  status TEXT NOT NULL,                         -- outbox | failed_<http status> | failed_network
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_email_outbox_to ON email_outbox(to_addr, id);
