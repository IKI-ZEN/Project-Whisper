CREATE TABLE IF NOT EXISTS prompt_library (
  id              TEXT    PRIMARY KEY,
  text            TEXT    NOT NULL,
  label           TEXT    NOT NULL DEFAULT '',
  tags            TEXT    NOT NULL DEFAULT '[]',
  embedding_cache TEXT,
  created_at      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_prompt_library_created ON prompt_library(created_at);
