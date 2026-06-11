-- Structured error log for Worker runtime errors.
-- Replaces ephemeral console.error() with queryable D1 rows.
-- Surfaced at GET /api/monitor/errors (CF Access gated).
CREATE TABLE IF NOT EXISTS error_log (
  id          TEXT    NOT NULL PRIMARY KEY,
  context     TEXT    NOT NULL,          -- handler or job name, e.g. "queue:file_process"
  message     TEXT    NOT NULL,
  stack       TEXT    NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_error_log_created ON error_log(created_at);
CREATE INDEX IF NOT EXISTS idx_error_log_context ON error_log(context);
