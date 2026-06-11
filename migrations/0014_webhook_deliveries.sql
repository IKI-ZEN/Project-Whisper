-- Track outbound webhook delivery attempts from probe runs.
-- Provides visibility into delivery success/failure and enables retry logic.
CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id            TEXT    NOT NULL PRIMARY KEY,
  probe_id      TEXT    NOT NULL,
  run_id        TEXT    NOT NULL,
  url_hash      TEXT    NOT NULL,          -- SHA-256 of the webhook URL (not stored in clear)
  status_code   INTEGER,                   -- HTTP status of the delivery attempt; NULL = network error
  delivered_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_probe ON webhook_deliveries(probe_id);
CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_run   ON webhook_deliveries(run_id);
