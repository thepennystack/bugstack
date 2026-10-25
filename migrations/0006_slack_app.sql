CREATE TABLE slack_app (
  slack_app_id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  client_id TEXT NOT NULL,
  client_secret TEXT NOT NULL,
  signing_secret TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE slack_oauth_state (
  state TEXT NOT NULL PRIMARY KEY,
  slack_app_id TEXT NOT NULL REFERENCES slack_app (slack_app_id),
  created_at TEXT NOT NULL
) STRICT;

DELETE FROM slack_channel;

DROP TABLE slack_workspace;

CREATE TABLE slack_workspace (
  workspace_id TEXT NOT NULL PRIMARY KEY,
  slack_app_id TEXT NOT NULL REFERENCES slack_app (slack_app_id),
  team_id TEXT NOT NULL,
  team_name TEXT NOT NULL,
  bot_token TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX slack_workspace_team ON slack_workspace (team_id);

CREATE INDEX slack_workspace_app ON slack_workspace (slack_app_id);
