PRAGMA foreign_keys = ON;
CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY, public_key TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS accounts (
  workspace TEXT NOT NULL REFERENCES workspaces(id), email TEXT NOT NULL,
  role TEXT NOT NULL CHECK(role IN ('hq','employee')), credential_hash TEXT NOT NULL,
  version INTEGER NOT NULL DEFAULT 1, issued_at TEXT,
  PRIMARY KEY(workspace,email)
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY, workspace TEXT NOT NULL, email TEXT NOT NULL, expires_at INTEGER NOT NULL,
  FOREIGN KEY(workspace,email) REFERENCES accounts(workspace,email)
);
CREATE TABLE IF NOT EXISTS directives (
  id TEXT PRIMARY KEY, workspace TEXT NOT NULL, recipient TEXT NOT NULL,
  version INTEGER NOT NULL, envelope TEXT NOT NULL, created_at TEXT NOT NULL,
  FOREIGN KEY(workspace,recipient) REFERENCES accounts(workspace,email)
);
CREATE INDEX IF NOT EXISTS directives_inbox ON directives(workspace,recipient,created_at DESC);
CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);

CREATE TABLE IF NOT EXISTS request_limits (
  bucket TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS revoked_accounts (
  workspace TEXT NOT NULL,
  email TEXT NOT NULL,
  revoked_at TEXT NOT NULL,
  PRIMARY KEY (workspace, email),
  FOREIGN KEY (workspace, email) REFERENCES accounts(workspace, email)
);
