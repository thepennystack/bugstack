DROP TABLE report_image;

DROP TABLE image;

CREATE TABLE image (
  image_id TEXT NOT NULL PRIMARY KEY,
  report_id TEXT NOT NULL REFERENCES report (report_id),
  position INTEGER NOT NULL,
  content_type TEXT NOT NULL CHECK (
    content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  ),
  size INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Reserved', 'Stored')),
  created_at TEXT NOT NULL
) STRICT;

CREATE UNIQUE INDEX image_report ON image (report_id, position);

ALTER TABLE github_issue ADD COLUMN image_count INTEGER NOT NULL DEFAULT 0;
