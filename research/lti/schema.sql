CREATE TABLE IF NOT EXISTS lti_handshakes (
  state_hash TEXT PRIMARY KEY,
  browser_hash TEXT NOT NULL,
  nonce TEXT NOT NULL,
  issuer TEXT NOT NULL,
  client_id TEXT NOT NULL,
  target_uri TEXT NOT NULL,
  deployment_hint TEXT NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS lti_handshakes_expiry ON lti_handshakes(expires_at);
