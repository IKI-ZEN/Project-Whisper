-- Bind probes and assertion suites to a specific sandbox (opt-in, nullable).
-- When sandbox_id IS NOT NULL the probe/suite acts as a health monitor for that app.
ALTER TABLE probes           ADD COLUMN sandbox_id TEXT;
ALTER TABLE assertion_suites ADD COLUMN sandbox_id TEXT;

CREATE INDEX IF NOT EXISTS idx_probes_sandbox_id     ON probes(sandbox_id)            WHERE sandbox_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_assertions_sandbox_id ON assertion_suites(sandbox_id)  WHERE sandbox_id IS NOT NULL;

-- Rich per-run metrics JSON alongside the existing single metric_value scalar.
-- metric_value kept for backwards compat; metrics_json stores all meaningful numbers.
ALTER TABLE probe_runs ADD COLUMN metrics_json TEXT NOT NULL DEFAULT '{}';

-- Source-trace vault entries back to a specific sandbox for per-app queries.
ALTER TABLE vault_records ADD COLUMN sandbox_id TEXT;
CREATE INDEX IF NOT EXISTS idx_vault_sandbox_id ON vault_records(sandbox_id) WHERE sandbox_id IS NOT NULL;
