CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password TEXT NOT NULL,
  version TEXT NOT NULL,
  created_at TEXT NOT NULL,
  reset_hash TEXT,
  reset_expires INTEGER,
  reset_attempts INTEGER NOT NULL DEFAULT 0,
  reset_sent_at INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS vault_chunks (
  account_id TEXT NOT NULL REFERENCES accounts(id),
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  PRIMARY KEY(account_id, chunk_index)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id),
  version TEXT NOT NULL,
  expires INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS session_account ON sessions(account_id);
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  hits INTEGER NOT NULL,
  expires INTEGER NOT NULL
);
