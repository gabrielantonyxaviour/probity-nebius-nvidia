-- Probity D1 schema. Synthetic payer (Halvorsen Mission Systems): vendor master, AP and payment runs.
-- Bank accounts are stored as last four digits plus a SHA-256 hash only; a full account number never exists here.

CREATE TABLE IF NOT EXISTS vendors (
  vendor_id TEXT PRIMARY KEY,
  legal_name TEXT NOT NULL,
  legal_name_norm TEXT NOT NULL,
  is_fictional INTEGER NOT NULL,
  uei TEXT,
  registrant_cik TEXT,
  remit_line1 TEXT,
  remit_unit TEXT,
  remit_city TEXT,
  remit_state TEXT,
  remit_zip TEXT,
  status TEXT NOT NULL,
  merged_into TEXT,
  legacy_vendor_no TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vendors_norm ON vendors(legal_name_norm);

CREATE TABLE IF NOT EXISTS vendor_bank_accounts (
  bank_account_id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  bank_name TEXT NOT NULL,
  routing TEXT NOT NULL,
  account_last4 TEXT NOT NULL,
  account_hash TEXT NOT NULL,
  status TEXT NOT NULL,            -- active | superseded | closed
  changed_at TEXT NOT NULL,
  source_request_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_vba_vendor ON vendor_bank_accounts(vendor_id);
CREATE INDEX IF NOT EXISTS idx_vba_hash ON vendor_bank_accounts(account_hash);

CREATE TABLE IF NOT EXISTS vendor_contacts (
  contact_id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- phone | email
  value TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,                   -- null = current
  changed_via TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vc_vendor ON vendor_contacts(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_domains (
  vendor_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  added_at TEXT NOT NULL,
  PRIMARY KEY (vendor_id, domain)
);

CREATE TABLE IF NOT EXISTS vendor_remit_history (
  remit_id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  line1 TEXT NOT NULL,
  unit TEXT,
  city TEXT NOT NULL,
  state TEXT NOT NULL,
  zip TEXT NOT NULL,
  valid_from TEXT NOT NULL,
  valid_to TEXT,
  changed_via TEXT NOT NULL,
  source_request_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_vrh_vendor ON vendor_remit_history(vendor_id);

CREATE TABLE IF NOT EXISTS vendor_contact_log (
  log_id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  request_id TEXT,
  purpose TEXT NOT NULL,
  phone_e164 TEXT NOT NULL,
  phone_source TEXT NOT NULL,
  outcome TEXT NOT NULL,
  called_at TEXT NOT NULL,
  called_by TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS bank_change_history (
  request_id TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  claimed_name TEXT NOT NULL,
  new_routing TEXT,
  new_account_last4 TEXT,
  new_account_hash TEXT,
  sender_domain TEXT,
  letter_phones TEXT,
  received_at TEXT NOT NULL,
  requested_effective TEXT,
  channel TEXT,
  status TEXT NOT NULL             -- applied | rejected | withdrawn
);

CREATE TABLE IF NOT EXISTS ap_invoices (
  invoice_no TEXT PRIMARY KEY,
  vendor_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  invoice_date TEXT NOT NULL,
  status TEXT NOT NULL             -- paid | scheduled | approved | open | void
);
CREATE INDEX IF NOT EXISTS idx_inv_vendor ON ap_invoices(vendor_id);

CREATE TABLE IF NOT EXISTS payment_runs (
  payment_run_id TEXT PRIMARY KEY,
  scheduled_date TEXT NOT NULL,
  cutoff_at TEXT NOT NULL,         -- ISO UTC of the release cut-off (14:00 US Eastern)
  status TEXT NOT NULL             -- released | scheduled | draft
);

CREATE TABLE IF NOT EXISTS payment_run_items (
  item_id TEXT PRIMARY KEY,
  payment_run_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,
  invoice_no TEXT NOT NULL,
  bank_account_id TEXT NOT NULL,
  amount_cents INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pri_run ON payment_run_items(payment_run_id, vendor_id);

-- ---- Probity application tables ----

CREATE TABLE IF NOT EXISTS requests (
  id TEXT PRIMARY KEY,             -- BCR-2026-0412
  vendor_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- bank_change | remit_change
  received_at TEXT NOT NULL,
  sender_email TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,   -- next payment-run amount that would go to the new details
  next_run_at TEXT,
  status TEXT NOT NULL DEFAULT 'unchecked',  -- unchecked | checking | checked | closed
  latest_run_id TEXT,
  outcome TEXT,                    -- confirmed | denied | no_answer
  swept_at TEXT,
  synthetic INTEGER NOT NULL DEFAULT 1,
  letter_key TEXT NOT NULL,        -- R2 key of the PDF
  eml_key TEXT,                    -- R2 key of the e-mail headers, null for mailed or portal requests
  json TEXT NOT NULL               -- channel, claimed name, e-mail block, payment run id
);
CREATE INDEX IF NOT EXISTS idx_requests_received ON requests(received_at);

CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL,
  status TEXT NOT NULL,
  live INTEGER NOT NULL,
  json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_runs_request ON runs(request_id);

CREATE TABLE IF NOT EXISTS usage (
  day TEXT NOT NULL,               -- YYYY-MM-DD (UTC) for live checks; YYYY-MM for tavily credits
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,              -- live_check | tavily_lookup | tavily_credit
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, session_id, kind)
);

CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT
);

CREATE TABLE IF NOT EXISTS sweep_reports (
  job_id TEXT PRIMARY KEY,
  json TEXT,
  created_at TEXT
);
