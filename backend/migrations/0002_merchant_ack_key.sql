-- Server-only key for authenticating mock merchant statements.
CREATE TABLE app_secrets (
 name TEXT PRIMARY KEY,
 value TEXT NOT NULL
);
