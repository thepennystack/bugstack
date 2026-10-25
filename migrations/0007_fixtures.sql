PRAGMA defer_foreign_keys = true;

DELETE FROM slack_channel;

DROP TABLE slack_oauth_state;

DROP TABLE slack_workspace;

DROP TABLE slack_app;

DROP TABLE github_app_state;

DROP TABLE github_app;

CREATE TABLE slack_workspace (
  workspace_id TEXT NOT NULL PRIMARY KEY,
  team_id TEXT NOT NULL UNIQUE,
  team_name TEXT NOT NULL,
  bot_token TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE slack_oauth_state (
  state TEXT NOT NULL PRIMARY KEY,
  created_at TEXT NOT NULL
) STRICT;

DROP INDEX app_github_app;

ALTER TABLE app DROP COLUMN github_app_id;

UPDATE app SET github_installation_id = 0;

PRAGMA defer_foreign_keys = false;
