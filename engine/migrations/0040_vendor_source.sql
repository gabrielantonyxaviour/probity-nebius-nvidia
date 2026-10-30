-- Where a vendor came from, so the list can say so and deletion can be limited: xero (synced, read-only here), manual, sample (copied from the demo company).
ALTER TABLE vendors ADD COLUMN source TEXT NOT NULL DEFAULT 'manual';
UPDATE vendors SET source = 'xero' WHERE vendor_id LIKE 'xero\_%' ESCAPE '\';
UPDATE vendors SET source = 'sample' WHERE org_id = 'org_demo' OR vendor_id LIKE 'T-%';
CREATE INDEX IF NOT EXISTS idx_vendors_org ON vendors(org_id, status);
