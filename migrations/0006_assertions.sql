CREATE TABLE IF NOT EXISTS assertion_suites (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  cases       TEXT    NOT NULL DEFAULT '[]',
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_assertion_suites_created ON assertion_suites(created_at);

CREATE TABLE IF NOT EXISTS assertion_runs (
  id          TEXT    PRIMARY KEY,
  suite_id    TEXT    NOT NULL,
  ran_at      INTEGER NOT NULL,
  total_cases INTEGER NOT NULL DEFAULT 0,
  passed      INTEGER NOT NULL DEFAULT 0,
  failed      INTEGER NOT NULL DEFAULT 0,
  results     TEXT    NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS idx_assertion_runs_suite    ON assertion_runs(suite_id);
CREATE INDEX IF NOT EXISTS idx_assertion_runs_ran_at   ON assertion_runs(ran_at);
