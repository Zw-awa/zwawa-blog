PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS content (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('article', 'game', 'artwork', 'photo')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'archived')),
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

CREATE INDEX IF NOT EXISTS idx_content_status_published
  ON content(status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_type_status_published
  ON content(type, status, published_at DESC);
CREATE INDEX IF NOT EXISTS idx_content_updated
  ON content(updated_at DESC);

CREATE TABLE IF NOT EXISTS media (
  id TEXT PRIMARY KEY,
  object_key TEXT NOT NULL UNIQUE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  media_kind TEXT NOT NULL CHECK (media_kind IN ('image', 'video', 'audio', 'document', 'other')),
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0),
  width INTEGER,
  height INTEGER,
  alt_text TEXT NOT NULL DEFAULT '',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_media_created ON media(created_at DESC);

CREATE TABLE IF NOT EXISTS content_media (
  content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  media_id TEXT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'inline' CHECK (role IN ('cover', 'inline', 'gallery', 'attachment')),
  sort_order INTEGER NOT NULL DEFAULT 0,
  caption TEXT NOT NULL DEFAULT '',
  PRIMARY KEY(content_id, media_id, role)
);

CREATE INDEX IF NOT EXISTS idx_content_media_order
  ON content_media(content_id, role, sort_order);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS content_tags (
  content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  tag_id TEXT NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  PRIMARY KEY(content_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_content_tags_tag ON content_tags(tag_id, content_id);

CREATE TABLE IF NOT EXISTS revisions (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  revision_number INTEGER NOT NULL,
  source TEXT NOT NULL DEFAULT 'studio',
  snapshot_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(content_id, revision_number)
);

CREATE INDEX IF NOT EXISTS idx_revisions_content
  ON revisions(content_id, revision_number DESC);

CREATE TABLE IF NOT EXISTS slug_redirects (
  id TEXT PRIMARY KEY,
  content_id TEXT NOT NULL REFERENCES content(id) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK (type IN ('article', 'game', 'artwork', 'photo')),
  old_slug TEXT NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(type, old_slug)
);

CREATE TABLE IF NOT EXISTS site_settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  is_public INTEGER NOT NULL DEFAULT 0 CHECK (is_public IN (0, 1)),
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS external_platforms (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  label TEXT NOT NULL,
  profile_url TEXT NOT NULL DEFAULT '',
  handle TEXT NOT NULL DEFAULT '',
  feed_url TEXT NOT NULL DEFAULT '',
  config_json TEXT NOT NULL DEFAULT '{}',
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(platform, handle)
);

CREATE TABLE IF NOT EXISTS api_credentials (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  username TEXT NOT NULL,
  secret_hash TEXT NOT NULL,
  scopes_json TEXT NOT NULL DEFAULT '[]',
  last_used_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_api_credentials_username
  ON api_credentials(username, revoked_at);

CREATE TABLE IF NOT EXISTS metric_snapshots (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  metric_key TEXT NOT NULL,
  value_json TEXT NOT NULL,
  collection_mode TEXT NOT NULL DEFAULT 'automatic'
    CHECK (collection_mode IN ('automatic', 'manual', 'unavailable')),
  collected_at TEXT NOT NULL,
  stale_after TEXT,
  error_message TEXT,
  UNIQUE(source, metric_key)
);

CREATE INDEX IF NOT EXISTS idx_metric_snapshots_collected
  ON metric_snapshots(collected_at DESC);

CREATE TABLE IF NOT EXISTS link_checks (
  id TEXT PRIMARY KEY,
  url TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL DEFAULT '',
  status_code INTEGER,
  is_healthy INTEGER CHECK (is_healthy IN (0, 1)),
  response_ms INTEGER,
  checked_at TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

INSERT OR IGNORE INTO site_settings(key, value_json, is_public, updated_at) VALUES
  ('site.identity', '{"name":"ZWAWA","description":"技术、游戏与创作的个人档案馆","locale":"zh-CN"}', 1, CURRENT_TIMESTAMP),
  ('site.links', '[]', 1, CURRENT_TIMESTAMP),
  ('site.features', '{"search":true,"rss":true}', 1, CURRENT_TIMESTAMP);
