-- Every dollar Probity spends on Nebius: Token Factory calls (one row per model call) and Nebius job compute estimates.
-- Live checks and re-checks stop for good when the all-time total reaches the budget (see ops/spend.ts).
CREATE TABLE IF NOT EXISTS spend (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,            -- token_factory | nebius_job | seed
  usd REAL NOT NULL,
  org_id TEXT,
  run_id TEXT,
  model TEXT,
  note TEXT
);
CREATE INDEX IF NOT EXISTS idx_spend_run ON spend(run_id);
INSERT INTO spend (at, kind, usd, org_id, run_id, model, note) VALUES ('2026-10-30T00:00:00Z', 'seed', 0.35, NULL, NULL, NULL, 'Spent before the spend table existed (testing, first production checks)');
