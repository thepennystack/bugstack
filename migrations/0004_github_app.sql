CREATE TABLE github_app (
  github_app_id TEXT NOT NULL PRIMARY KEY,
  app_id_number INTEGER NOT NULL,
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  owner_login TEXT NOT NULL,
  private_key TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  webhook_secret TEXT NOT NULL,
  html_url TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE github_app_state (
  state TEXT NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL
) STRICT;

ALTER TABLE app ADD COLUMN github_app_id TEXT NOT NULL DEFAULT '';

CREATE INDEX app_github_app ON app (github_app_id);
