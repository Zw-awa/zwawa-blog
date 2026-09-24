PRAGMA foreign_keys = OFF;

CREATE TABLE content_scheduled (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('article', 'game', 'artwork', 'photo')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'scheduled', 'published', 'archived')),
  title TEXT NOT NULL,
  slug TEXT NOT NULL,
  summary TEXT NOT NULL DEFAULT '',
  body_markdown TEXT NOT NULL DEFAULT '',
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  translation_group TEXT,
  cover_media_id TEXT REFERENCES media(id) ON DELETE SET NULL,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  published_at TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(type, slug)
);

INSERT INTO content_scheduled SELECT * FROM content;
DROP TABLE content;
ALTER TABLE content_scheduled RENAME TO content;

CREATE INDEX idx_content_status_published ON content(status, published_at DESC);
CREATE INDEX idx_content_type_status_published ON content(type, status, published_at DESC);
CREATE INDEX idx_content_updated ON content(updated_at DESC);

PRAGMA foreign_keys = ON;
