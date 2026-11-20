CREATE TABLE events (
  id TEXT PRIMARY KEY,
  killer_name TEXT NOT NULL,
  credential_verifier TEXT NOT NULL,
  auth_salt TEXT NOT NULL,
  encryption_salt TEXT NOT NULL,
  kdf_iterations INTEGER NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE targets (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  name TEXT NOT NULL,
  condition TEXT NOT NULL,
  position INTEGER NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE victories (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  target_id TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  photo_key TEXT,
  FOREIGN KEY (event_id) REFERENCES events(id),
  FOREIGN KEY (target_id) REFERENCES targets(id)
);

CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  FOREIGN KEY (event_id) REFERENCES events(id)
);

CREATE TABLE rate_limits (
  key_hash TEXT PRIMARY KEY,
  window_start INTEGER NOT NULL,
  attempts INTEGER NOT NULL
);

CREATE INDEX targets_event_position_idx ON targets(event_id, position);
CREATE INDEX victories_event_idx ON victories(event_id);
