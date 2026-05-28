ALTER TABLE usage_metrics ADD COLUMN provider  TEXT;
ALTER TABLE usage_metrics ADD COLUMN call_type TEXT NOT NULL DEFAULT 'complete';
ALTER TABLE usage_metrics ADD COLUMN cost_usd  REAL NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_metrics_provider  ON usage_metrics(provider);
CREATE INDEX IF NOT EXISTS idx_metrics_call_type ON usage_metrics(call_type);
CREATE INDEX IF NOT EXISTS idx_metrics_time      ON usage_metrics(created_at);
