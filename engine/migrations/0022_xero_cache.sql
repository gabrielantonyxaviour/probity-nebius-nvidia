-- Xero as the vendor master (Sonnet B). Contacts are synced into the same vendors / vendor_bank_accounts / vendor_contacts /
-- vendor_domains tables the seeded company uses (vendor_id = 'xero_<ContactID>', org_id = the company), so matching, checks and
-- evidence need no special case. Bank accounts keep only the last four digits and a SHA-256 hash. Open bills feed amount at risk.
CREATE TABLE IF NOT EXISTS xero_bills (
  org_id TEXT NOT NULL,
  invoice_id TEXT NOT NULL,
  vendor_id TEXT NOT NULL,           -- xero_<ContactID>
  number TEXT,
  amount_due_cents INTEGER NOT NULL,
  currency TEXT,
  due_date TEXT,                     -- YYYY-MM-DD
  status TEXT NOT NULL,              -- AUTHORISED | SUBMITTED
  PRIMARY KEY (org_id, invoice_id)
);
CREATE INDEX IF NOT EXISTS idx_xero_bills_vendor ON xero_bills(org_id, vendor_id);

CREATE TABLE IF NOT EXISTS xero_sync (
  org_id TEXT PRIMARY KEY,
  synced_at TEXT,
  status TEXT NOT NULL,              -- ok | error
  detail TEXT,
  vendors INTEGER NOT NULL DEFAULT 0,
  bills INTEGER NOT NULL DEFAULT 0
);
