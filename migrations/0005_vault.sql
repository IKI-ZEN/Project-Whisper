CREATE TABLE IF NOT EXISTS vault_records (
  id            TEXT    PRIMARY KEY,
  prompt        TEXT    NOT NULL,
  response      TEXT    NOT NULL DEFAULT '',
  model         TEXT    NOT NULL DEFAULT '',
  temperature   REAL    NOT NULL DEFAULT 0.7,
  system_prompt TEXT    NOT NULL DEFAULT '',
  tool          TEXT    NOT NULL DEFAULT '',
  metadata      TEXT    NOT NULL DEFAULT '{}',
  tags          TEXT    NOT NULL DEFAULT '[]',
  created_at    INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vault_model      ON vault_records(model);
CREATE INDEX IF NOT EXISTS idx_vault_tool       ON vault_records(tool);
CREATE INDEX IF NOT EXISTS idx_vault_created_at ON vault_records(created_at);
