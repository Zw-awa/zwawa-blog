PRAGMA foreign_keys = ON;

INSERT OR IGNORE INTO content(
  id, type, status, title, slug, summary, body_markdown, locale,
  translation_group, cover_media_id, metadata_json, published_at,
  archived_at, created_at, updated_at
) VALUES
  (
    'seed-welcome', 'article', 'published', '欢迎来到 ZWAWA 档案馆', 'welcome-to-zwawa',
    '关于这座个人档案馆，以及技术、游戏和创作会如何在这里相遇。',
    replace('## 第一盏灯\n\n这里保存值得长期留下的内容：技术文章、多人游戏记录、画作与摄影。\n\n- 内容从 Studio 进入草稿箱\n- Markdown 可以在 Obsidian 与 VS Code 之间往返\n- 发布后的记录拥有稳定地址\n\n```ts\nconst archive = ["code", "games", "art", "photo"];\n```', '\n', char(10)),
    'zh-CN', NULL, NULL, '{"readingTime":"2 分钟"}', CURRENT_TIMESTAMP,
    NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'seed-terraria', 'game', 'published', '泰拉瑞亚多人世界：第一夜', 'terraria-first-night',
    '从第一棵树开始，记下多人世界最初的坐标。',
    replace('## 出生点\n\n木材还不够盖一间像样的房子，但第一夜已经有了值得记录的故事。\n\n> 世界会重开，同行的人与发生过的事应该留下。', '\n', char(10)),
    'zh-CN', NULL, NULL, '{"game":"Terraria","entryType":"联机日志"}', CURRENT_TIMESTAMP,
    NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'seed-art-draft', 'artwork', 'draft', '未公开画作', 'artwork-draft',
    '用于验证画作后台字段与图集上传。', '', 'zh-CN', NULL, NULL,
    '{"medium":"数位绘画","series":"练习","year":"2026"}', NULL,
    NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  ),
  (
    'seed-photo-draft', 'photo', 'draft', '未公开摄影', 'photo-draft',
    '用于验证摄影后台字段与图集上传。', '', 'zh-CN', NULL, NULL,
    '{"location":"","camera":"","takenAt":""}', NULL,
    NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  );

INSERT OR IGNORE INTO tags(id, name, slug, created_at) VALUES
  ('seed-tag-archive', '站点档案', '站点档案', CURRENT_TIMESTAMP),
  ('seed-tag-terraria', 'terraria', 'terraria', CURRENT_TIMESTAMP),
  ('seed-tag-multiplayer', '多人游戏', '多人游戏', CURRENT_TIMESTAMP);

INSERT OR IGNORE INTO content_tags(content_id, tag_id) VALUES
  ('seed-welcome', 'seed-tag-archive'),
  ('seed-terraria', 'seed-tag-terraria'),
  ('seed-terraria', 'seed-tag-multiplayer');

INSERT OR IGNORE INTO external_platforms(
  id, platform, label, profile_url, handle, feed_url, config_json,
  enabled, created_at, updated_at
) VALUES
  ('seed-platform-github', 'github', 'GitHub', 'https://github.com/', '', '', '{}', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('seed-platform-docker', 'dockerhub', 'Docker Hub', 'https://hub.docker.com/', '', '', '{}', 0, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP);
