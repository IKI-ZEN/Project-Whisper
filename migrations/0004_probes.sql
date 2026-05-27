CREATE TABLE IF NOT EXISTS probes (
  id          TEXT    PRIMARY KEY,
  name        TEXT    NOT NULL,
  description TEXT    NOT NULL DEFAULT '',
  prompt      TEXT    NOT NULL,
  tool        TEXT    NOT NULL,
  params      TEXT    NOT NULL DEFAULT '{}',
  model       TEXT    NOT NULL DEFAULT '',
  schedule    TEXT    NOT NULL DEFAULT 'daily',
  threshold   TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL,
  last_run_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_probes_schedule   ON probes(schedule);
CREATE INDEX IF NOT EXISTS idx_probes_created_at ON probes(created_at);

CREATE TABLE IF NOT EXISTS probe_runs (
  id           TEXT    PRIMARY KEY,
  probe_id     TEXT    NOT NULL,
  tool         TEXT    NOT NULL,
  result       TEXT    NOT NULL DEFAULT '{}',
  metric_value REAL,
  run_at       INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_probe_runs_probe_id ON probe_runs(probe_id);
CREATE INDEX IF NOT EXISTS idx_probe_runs_run_at   ON probe_runs(run_at);
