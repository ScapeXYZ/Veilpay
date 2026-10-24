-- Preserve the existing mock table's constraints while adding network-bound operations.
ALTER TABLE wallet_operations RENAME TO wallet_operations_legacy;
CREATE TABLE wallet_operations (
 id TEXT PRIMARY KEY,
 payment_id TEXT NOT NULL UNIQUE,
 attempt INTEGER NOT NULL CHECK(attempt=1),
 backend TEXT NOT NULL CHECK(backend IN ('mock','zingo')),
 state TEXT NOT NULL CHECK(state IN ('pending','broadcast','mined','final','failed_definitive','unknown')),
 wallet_op_ref TEXT,
 txid TEXT,
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 network TEXT NOT NULL CHECK(network IN ('testnet','mainnet','regtest','legacy_mock')),
 invoice_id TEXT,
 destination TEXT,
 amount_zat INTEGER CHECK(amount_zat > 0 AND amount_zat <= 2100000000000000),
 last_reconciled_at TEXT,
 CHECK(backend != 'mock' OR txid IS NULL),
 CHECK(backend != 'zingo' OR (network != 'legacy_mock' AND invoice_id IS NOT NULL AND destination IS NOT NULL AND amount_zat IS NOT NULL))
);
INSERT INTO wallet_operations(id,payment_id,attempt,backend,state,wallet_op_ref,txid,created_at,updated_at,network)
 SELECT id,payment_id,attempt,backend,state,wallet_op_ref,txid,created_at,updated_at,'legacy_mock' FROM wallet_operations_legacy;
DROP TABLE wallet_operations_legacy;
CREATE INDEX wallet_operations_unresolved ON wallet_operations(network,state);
CREATE TABLE deployment_network (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1),
 network TEXT NOT NULL CHECK(network IN ('testnet','mainnet','regtest'))
);

-- One unresolved/successful external operation per invoice, including distinct payments.
CREATE UNIQUE INDEX wallet_invoice_execution ON wallet_operations(invoice_id)
 WHERE backend='zingo' AND state!='failed_definitive';
