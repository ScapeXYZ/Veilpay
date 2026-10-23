CREATE TABLE records (
 kind TEXT NOT NULL,
 id TEXT NOT NULL,
 owner TEXT NOT NULL,
 body TEXT NOT NULL CHECK(json_valid(body)),
 PRIMARY KEY(kind,id)
);
CREATE INDEX records_owner ON records(kind,owner,id);
CREATE TABLE sessions (
 token TEXT PRIMARY KEY,
 context TEXT NOT NULL CHECK(context IN ('customer','merchant')),
 csrf TEXT NOT NULL,
 expires_at TEXT NOT NULL
);
CREATE TABLE idempotency (
 principal TEXT NOT NULL,
 operation TEXT NOT NULL,
 key TEXT NOT NULL,
 payload TEXT NOT NULL,
 status INTEGER NOT NULL,
 body TEXT NOT NULL,
 created_at TEXT NOT NULL,
 PRIMARY KEY(principal,operation,key)
);
CREATE TABLE demo_rate_limits (
 ip TEXT PRIMARY KEY,
 window_start INTEGER NOT NULL,
 count INTEGER NOT NULL
);
-- Immutable versions and decisions are separate records; never overwritten.
CREATE TABLE wallet_operations (
 id TEXT PRIMARY KEY,
 payment_id TEXT NOT NULL UNIQUE,
 attempt INTEGER NOT NULL CHECK(attempt=1),
 backend TEXT NOT NULL CHECK(backend='mock'),
 state TEXT NOT NULL,
 wallet_op_ref TEXT,
 txid TEXT CHECK(txid IS NULL),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL
);
