CREATE TABLE IF NOT EXISTS revoked_accounts (
  workspace TEXT NOT NULL,
  email TEXT NOT NULL,
  revoked_at TEXT NOT NULL,
  PRIMARY KEY (workspace, email),
  FOREIGN KEY (workspace, email) REFERENCES accounts(workspace, email)
);
