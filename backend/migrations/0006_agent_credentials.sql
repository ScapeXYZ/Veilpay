-- Bearer values are never persisted.  A credential is scoped to one owner and
-- one agent; the database contains only a SHA-256 verifier and safe metadata.
CREATE TABLE agent_credentials (
 id TEXT PRIMARY KEY,
 agent_id TEXT NOT NULL,
 owner TEXT NOT NULL,
 token_hash TEXT NOT NULL UNIQUE,
 token_hint TEXT NOT NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT,
 last_used_at TEXT
);
CREATE INDEX agent_credentials_scope ON agent_credentials(owner, agent_id);

CREATE TABLE agent_credential_rate_limits (
 credential_id TEXT PRIMARY KEY,
 window_start INTEGER NOT NULL,
 count INTEGER NOT NULL
);
