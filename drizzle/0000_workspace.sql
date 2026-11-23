CREATE TABLE sessions (token TEXT PRIMARY KEY, principal TEXT NOT NULL, expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE documents (id TEXT PRIMARY KEY, owner TEXT NOT NULL, cohort TEXT NOT NULL, created INTEGER NOT NULL, expires INTEGER NOT NULL, indexed INTEGER NOT NULL, kind TEXT NOT NULL, words INTEGER NOT NULL, body TEXT NOT NULL, audit TEXT NOT NULL);
--> statement-breakpoint
CREATE INDEX cohort_documents ON documents(cohort,indexed,created);
--> statement-breakpoint
CREATE INDEX owner_documents ON documents(owner,created);
--> statement-breakpoint
CREATE TABLE drafts (owner TEXT PRIMARY KEY, revision INTEGER NOT NULL, state TEXT NOT NULL, expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE rate_limits (key TEXT PRIMARY KEY, attempts INTEGER NOT NULL, expires INTEGER NOT NULL);
--> statement-breakpoint
CREATE TABLE members (username TEXT PRIMARY KEY, identity TEXT UNIQUE NOT NULL, cohort TEXT NOT NULL, role TEXT NOT NULL, verifier TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE evidence_runs (id TEXT PRIMARY KEY, data TEXT NOT NULL);
--> statement-breakpoint
CREATE TABLE lti_handshakes (state_hash TEXT PRIMARY KEY,browser_hash TEXT NOT NULL,nonce TEXT NOT NULL,issuer TEXT NOT NULL,client_id TEXT NOT NULL,target_uri TEXT NOT NULL,deployment_hint TEXT NOT NULL,expires_at INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX lti_handshakes_expiry ON lti_handshakes(expires_at);
