-- Saved pipeline definitions (DAG execution engine persistence)
CREATE TABLE IF NOT EXISTS pipelines (
  id          TEXT PRIMARY KEY,
  name        TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  nodes       TEXT NOT NULL,   -- JSON: PipelineNode[]
  entry_id    TEXT NOT NULL,
  created_at  INTEGER NOT NULL,
  updated_at  INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_pipelines_created ON pipelines(created_at);

-- Probe webhook alerts: POST to this URL when a threshold is breached
ALTER TABLE probes ADD COLUMN webhook_url TEXT;
