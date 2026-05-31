-- Chat Environments platform integration
-- Adds environment_id linkage to vault records and probes for scoped querying

ALTER TABLE vault_records ADD COLUMN environment_id TEXT;
CREATE INDEX IF NOT EXISTS idx_vault_environment ON vault_records(environment_id);

ALTER TABLE probes ADD COLUMN environment_id TEXT;
CREATE INDEX IF NOT EXISTS idx_probes_environment ON probes(environment_id);
