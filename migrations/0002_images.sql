CREATE TABLE image (
  image_id TEXT NOT NULL PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES app (app_id),
  client_id TEXT NOT NULL REFERENCES client (client_id),
  content_type TEXT NOT NULL CHECK (
    content_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')
  ),
  size INTEGER NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('Reserved', 'Stored')),
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE report_image (
  report_id TEXT NOT NULL REFERENCES report (report_id),
  image_id TEXT NOT NULL REFERENCES image (image_id),
  position INTEGER NOT NULL,
  PRIMARY KEY (report_id, image_id)
) STRICT;

CREATE UNIQUE INDEX report_image_image ON report_image (image_id);
