-- Add request_id to sandbox_events to correlate HTTP responses with audit log entries.
-- The X-Request-ID response header carries the same UUID so clients can reference it in bug reports.
ALTER TABLE sandbox_events ADD COLUMN request_id TEXT;
CREATE INDEX IF NOT EXISTS idx_events_request_id ON sandbox_events(request_id);
