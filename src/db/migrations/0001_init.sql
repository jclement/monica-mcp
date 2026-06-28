-- Multi-user: any number of independent users self-register. There is no admin.
-- Every credential, token, grant, Monica account and audit row is scoped to a user.
CREATE TABLE users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  display_name  TEXT NOT NULL,
  user_handle   BLOB NOT NULL UNIQUE,       -- WebAuthn user handle (per user)
  created_at    INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE TABLE passkey_credentials (
  id              TEXT PRIMARY KEY,           -- base64url credential ID
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name            TEXT NOT NULL,
  public_key      BLOB NOT NULL,              -- COSE key
  counter         INTEGER NOT NULL DEFAULT 0,
  transports      TEXT,                       -- JSON array
  device_type     TEXT,
  backed_up       INTEGER NOT NULL DEFAULT 0,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at    INTEGER
);

-- short-lived, single-use; bound to browser via random id cookie
CREATE TABLE webauthn_challenges (
  id          TEXT PRIMARY KEY,
  type        TEXT NOT NULL CHECK (type IN ('registration','authentication')),
  challenge   TEXT NOT NULL,
  expires_at  INTEGER NOT NULL
);

CREATE TABLE ui_sessions (
  id           TEXT PRIMARY KEY,              -- SHA-256 of cookie value
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  expires_at   INTEGER NOT NULL,
  last_seen_at INTEGER,
  user_agent   TEXT
);

-- RFC 7591 dynamic clients are global (any user may use a registered client),
-- but consent and grants below are per-user.
CREATE TABLE oauth_clients (
  client_id      TEXT PRIMARY KEY,
  client_name    TEXT NOT NULL DEFAULT 'Unnamed client',
  redirect_uris  TEXT NOT NULL,               -- JSON array
  logo_uri       TEXT,
  created_at     INTEGER NOT NULL DEFAULT (unixepoch())
);

-- one row per (client, user) the user has approved
CREATE TABLE oauth_consents (
  client_id    TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  consented_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (client_id, user_id)
);

CREATE TABLE oauth_authorization_codes (
  code_hash       TEXT PRIMARY KEY,
  client_id       TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  redirect_uri    TEXT NOT NULL,
  code_challenge  TEXT NOT NULL,               -- S256 only
  resource        TEXT,
  expires_at      INTEGER NOT NULL,
  used_at         INTEGER
);

-- one row per grant; access+refresh rotate in place. Bound to the user who consented.
CREATE TABLE oauth_grants (
  id                  TEXT PRIMARY KEY,
  client_id           TEXT NOT NULL REFERENCES oauth_clients(client_id) ON DELETE CASCADE,
  user_id             INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  access_token_hash   TEXT NOT NULL UNIQUE,
  access_expires_at   INTEGER NOT NULL,
  refresh_token_hash  TEXT NOT NULL UNIQUE,
  refresh_expires_at  INTEGER NOT NULL,
  prev_refresh_hash   TEXT,
  prev_rotated_at     INTEGER,
  created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at        INTEGER,
  revoked_at          INTEGER
);

-- static bearer tokens (Claude Code etc.), scoped to the user who created them
CREATE TABLE api_tokens (
  id            TEXT PRIMARY KEY,
  user_id       INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  token_prefix  TEXT NOT NULL,
  token_hash    TEXT NOT NULL UNIQUE,
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at  INTEGER,
  revoked_at    INTEGER
);

-- Each user connects exactly ONE Monica account: a base URL + API token. The
-- token is encrypted at rest with AES-256-GCM under the server MASTER_KEY and is
-- never stored or logged in plaintext. user_id is the PRIMARY KEY, which enforces
-- one account per user.
CREATE TABLE monica_accounts (
  user_id          INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  base_url         TEXT NOT NULL,                 -- normalized Monica origin (no /api, no trailing /)
  token_type       TEXT NOT NULL DEFAULT 'bearer',
  token_ciphertext BLOB NOT NULL,
  token_nonce      BLOB NOT NULL,
  token_tag        BLOB NOT NULL,
  token_last4      TEXT,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  last_used_at     INTEGER
);

-- unified event log: agent (MCP tool) calls + owner security/config actions
CREATE TABLE audit_log (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL DEFAULT (unixepoch()),
  user_id     INTEGER,                         -- tenant (NULL for pre-auth events)
  source      TEXT NOT NULL DEFAULT 'agent',   -- agent | security | config
  actor_kind  TEXT NOT NULL,                   -- static | oauth | user
  actor_name  TEXT NOT NULL,
  connection  TEXT,                            -- reserved (unused; single account per user)
  event       TEXT NOT NULL,                   -- tool name or admin event
  action      TEXT,
  target      TEXT,
  status      TEXT NOT NULL DEFAULT 'ok',
  detail      TEXT
);

CREATE TABLE settings (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE INDEX idx_grants_access  ON oauth_grants(access_token_hash);
CREATE INDEX idx_grants_refresh ON oauth_grants(refresh_token_hash);
CREATE INDEX idx_sessions_expiry ON ui_sessions(expires_at);
CREATE INDEX idx_audit_ts ON audit_log(id DESC);
CREATE INDEX idx_audit_user ON audit_log(user_id, id DESC);
