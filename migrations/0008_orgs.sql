PRAGMA defer_foreign_keys = true;

CREATE TABLE org (
  org_id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE member (
  member_id TEXT NOT NULL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org (org_id),
  identity TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('Owner', 'Member')),
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX member_org_identity ON member (org_id, identity);

CREATE INDEX member_identity ON member (identity);

CREATE TABLE github_installation (
  installation_id INTEGER NOT NULL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org (org_id),
  account TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX github_installation_org ON github_installation (org_id);

CREATE TABLE github_install_state (
  state TEXT NOT NULL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org (org_id),
  identity TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

INSERT INTO org (org_id, name, created_at)
VALUES ('aqy1hvijv0b22fgnhowiewso6', 'ischen', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

INSERT INTO member (member_id, org_id, identity, role, created_at)
VALUES
  ('bhpurtf3nban1hrz5ms4nok39', 'aqy1hvijv0b22fgnhowiewso6', 'matthijs@ischen.nl', 'Owner', strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  ('8j8wveqtbx23ajxxj6azgrx8k', 'aqy1hvijv0b22fgnhowiewso6', 'df74514f1459ceb09bb39d2655114cc5.access', 'Owner', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));

DELETE FROM slack_oauth_state;

DROP TABLE slack_oauth_state;

CREATE TABLE slack_oauth_state (
  state TEXT NOT NULL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org (org_id),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE app_next (
  app_id TEXT NOT NULL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org (org_id),
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  github_installation_id INTEGER NOT NULL,
  github_repo TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

INSERT INTO app_next (app_id, org_id, name, description, github_installation_id, github_repo, created_at)
SELECT app_id, 'aqy1hvijv0b22fgnhowiewso6', name, description, github_installation_id, github_repo, created_at
FROM app;

DROP TABLE app;

ALTER TABLE app_next RENAME TO app;

CREATE INDEX app_org ON app (org_id, created_at);

CREATE TABLE slack_workspace_next (
  workspace_id TEXT NOT NULL PRIMARY KEY,
  org_id TEXT NOT NULL REFERENCES org (org_id),
  team_id TEXT NOT NULL UNIQUE,
  team_name TEXT NOT NULL,
  bot_token TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

INSERT INTO slack_workspace_next (workspace_id, org_id, team_id, team_name, bot_token, created_at)
SELECT workspace_id, 'aqy1hvijv0b22fgnhowiewso6', team_id, team_name, bot_token, created_at
FROM slack_workspace;

DROP TABLE slack_workspace;

ALTER TABLE slack_workspace_next RENAME TO slack_workspace;

CREATE INDEX slack_workspace_org ON slack_workspace (org_id);

PRAGMA defer_foreign_keys = false;
