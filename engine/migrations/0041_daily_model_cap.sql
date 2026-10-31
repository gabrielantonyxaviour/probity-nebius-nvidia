-- One row per UTC day: every Token Factory call reserves its worst-case cost here before it is sent and settles to its
-- actual cost after; a call that would take the day past the cap is refused before it reaches Token Factory.
CREATE TABLE IF NOT EXISTS model_spend_day (
  day TEXT PRIMARY KEY,          -- YYYY-MM-DD (UTC)
  usd REAL NOT NULL DEFAULT 0,   -- reserved + settled spend for the day
  calls INTEGER NOT NULL DEFAULT 0,
  refused INTEGER NOT NULL DEFAULT 0
);
