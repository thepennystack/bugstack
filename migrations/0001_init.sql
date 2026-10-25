CREATE TABLE app (
  app_id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL,
  github_installation_id INTEGER NOT NULL,
  github_repo TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE client (
  client_id TEXT NOT NULL PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES app (app_id),
  name TEXT NOT NULL,
  secret TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Active', 'Revoked')),
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX client_app ON client (app_id, created_at);

CREATE TABLE slack_workspace (
  workspace_id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  bot_token TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE slack_channel (
  app_id TEXT NOT NULL PRIMARY KEY REFERENCES app (app_id),
  workspace_id TEXT NOT NULL REFERENCES slack_workspace (workspace_id),
  channel TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE INDEX slack_channel_workspace ON slack_channel (workspace_id);

CREATE TABLE report (
  report_id TEXT NOT NULL PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES app (app_id),
  client_id TEXT NOT NULL REFERENCES client (client_id),
  received_at TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Filed', 'Failed')),
  attempts INTEGER NOT NULL,
  next_attempt_at TEXT NOT NULL
) STRICT;

CREATE INDEX report_due ON report (status, next_attempt_at);

CREATE INDEX report_app ON report (app_id, received_at);

CREATE TABLE github_issue (
  report_id TEXT NOT NULL PRIMARY KEY REFERENCES report (report_id),
  number INTEGER NOT NULL,
  url TEXT NOT NULL,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE slack_post (
  report_id TEXT NOT NULL PRIMARY KEY REFERENCES report (report_id),
  posted_at TEXT NOT NULL
) STRICT;

CREATE TABLE failure (
  report_id TEXT NOT NULL REFERENCES report (report_id),
  failed_at TEXT NOT NULL,
  step TEXT NOT NULL CHECK (step IN ('GitHub', 'Slack')),
  message TEXT NOT NULL,
  PRIMARY KEY (report_id, failed_at)
) STRICT;
