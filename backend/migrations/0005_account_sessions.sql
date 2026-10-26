-- Live accounts are deliberately independent of wallet connection data.  The
-- opaque session value is stored only as a hash; legacy fixture sessions keep
-- their original token column for backwards-compatible regtest coverage.
CREATE TABLE accounts (
 id TEXT PRIMARY KEY,
 display_name TEXT NOT NULL,
 account_type TEXT NOT NULL CHECK(account_type IN ('individual','freelancer','merchant','team','business')),
 context TEXT NOT NULL CHECK(context IN ('customer','merchant')),
 created_at TEXT NOT NULL
);

CREATE TABLE account_sessions (
 token_hash TEXT PRIMARY KEY,
 context TEXT NOT NULL CHECK(context IN ('customer','merchant')),
 csrf TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 principal TEXT NOT NULL REFERENCES accounts(id),
 account_id TEXT NOT NULL REFERENCES accounts(id)
);
