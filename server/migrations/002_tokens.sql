-- 002_tokens.sql — API bearer tokens for LLM/automation access.
-- Applied when PRAGMA user_version < 2. Only the hash is stored; the plaintext
-- token is shown once at creation time (GitHub-PAT style).

CREATE TABLE api_tokens (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  token_hash   TEXT NOT NULL UNIQUE,   -- sha256(plaintext) hex
  prefix       TEXT NOT NULL,          -- first chars of plaintext, for display only
  scope        TEXT NOT NULL DEFAULT 'read',  -- 'read' | 'read_write'
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);

CREATE INDEX idx_api_tokens_hash ON api_tokens(token_hash);
