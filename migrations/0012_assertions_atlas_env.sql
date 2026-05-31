-- Add environment_id to assertion_suites so suites can be scoped to an environment
ALTER TABLE assertion_suites ADD COLUMN environment_id TEXT;
CREATE INDEX IF NOT EXISTS idx_suites_environment ON assertion_suites(environment_id);

-- Add environment_id to prompt_library (atlas) for environment-scoped prompt collections
ALTER TABLE prompt_library ADD COLUMN environment_id TEXT;
CREATE INDEX IF NOT EXISTS idx_prompt_library_environment ON prompt_library(environment_id);
