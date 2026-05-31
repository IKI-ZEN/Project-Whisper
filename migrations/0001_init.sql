-- Audit log for all sandbox lifecycle events
CREATE TABLE IF NOT EXISTS sandbox_events (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sandbox_id  TEXT    NOT NULL,
  event_type  TEXT    NOT NULL, -- 'created' | 'run' | 'deleted' | 'vibe_created'
  metadata    TEXT    NOT NULL DEFAULT '{}',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_events_sandbox ON sandbox_events(sandbox_id);
CREATE INDEX IF NOT EXISTS idx_events_type    ON sandbox_events(event_type);
CREATE INDEX IF NOT EXISTS idx_events_time    ON sandbox_events(created_at);

-- Per-sandbox usage metrics
CREATE TABLE IF NOT EXISTS usage_metrics (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  sandbox_id  TEXT    NOT NULL,
  model       TEXT    NOT NULL,
  tokens_in   INTEGER NOT NULL DEFAULT 0,
  tokens_out  INTEGER NOT NULL DEFAULT 0,
  latency_ms  INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_metrics_sandbox ON usage_metrics(sandbox_id);
