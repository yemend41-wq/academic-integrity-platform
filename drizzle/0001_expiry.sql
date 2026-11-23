ALTER TABLE members ADD COLUMN expires INTEGER NOT NULL DEFAULT 0;
--> statement-breakpoint
CREATE TABLE housekeeping (id INTEGER PRIMARY KEY, last_attempt INTEGER NOT NULL, last_success INTEGER NOT NULL);
--> statement-breakpoint
CREATE INDEX documents_expiry ON documents(expires);
--> statement-breakpoint
CREATE INDEX draft_expiry ON drafts(expires);
--> statement-breakpoint
CREATE INDEX session_expiry ON sessions(expires);
