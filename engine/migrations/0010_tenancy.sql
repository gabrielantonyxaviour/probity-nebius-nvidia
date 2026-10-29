-- Tenancy (Sonnet A). Every request, run, usage counter and vendor belongs to a company (org). Existing rows are the demo company.
ALTER TABLE requests ADD COLUMN org_id TEXT NOT NULL DEFAULT 'org_demo';
ALTER TABLE requests ADD COLUMN source TEXT NOT NULL DEFAULT 'seed';   -- seed | upload | gmail | outlook
ALTER TABLE requests ADD COLUMN session_id TEXT;                       -- who uploaded it, for uploads into the shared demo company
ALTER TABLE requests ADD COLUMN message_id TEXT;                       -- the e-mail's id, so intake is idempotent
ALTER TABLE requests ADD COLUMN note TEXT;                             -- plain words shown with the request, e.g. why it was not checked
ALTER TABLE runs ADD COLUMN org_id TEXT NOT NULL DEFAULT 'org_demo';
ALTER TABLE usage ADD COLUMN org_id TEXT NOT NULL DEFAULT 'org_demo';
ALTER TABLE vendors ADD COLUMN org_id TEXT NOT NULL DEFAULT 'org_demo';

UPDATE requests SET source = 'upload' WHERE synthetic = 0;

CREATE INDEX IF NOT EXISTS idx_requests_org ON requests(org_id, received_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_requests_message ON requests(org_id, message_id) WHERE message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_runs_org ON runs(org_id, request_id);
CREATE INDEX IF NOT EXISTS idx_vendors_org ON vendors(org_id);
