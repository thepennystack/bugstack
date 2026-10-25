PRAGMA defer_foreign_keys = true;

CREATE TABLE report_next (
  report_id TEXT NOT NULL PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES app (app_id),
  client_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Pending', 'Filed', 'Failed')),
  attempts INTEGER NOT NULL,
  next_attempt_at TEXT NOT NULL
) STRICT;

INSERT INTO report_next (report_id, app_id, client_id, received_at, title, payload, status, attempts, next_attempt_at)
SELECT report_id, app_id, client_id, received_at, title, payload, status, attempts, next_attempt_at
FROM report;

DROP TABLE report;

ALTER TABLE report_next RENAME TO report;

CREATE INDEX report_due ON report (status, next_attempt_at);

CREATE INDEX report_app ON report (app_id, received_at);

PRAGMA defer_foreign_keys = false;
