import { AppError } from "./errors";
import type {
  ContentRecord,
  ContentMediaItem,
  ContentStatus,
  ContentType,
  ContentWriteInput,
  D1DatabaseLike,
  D1PreparedStatementLike,
  PaginatedResult
} from "./types";
import { normalizeTagSlug, parseJsonObject } from "./validation";

interface ContentRow {
  id: string;
  type: ContentType;
  status: ContentStatus;
  title: string;
  slug: string;
  summary: string;
  body_markdown: string;
  locale: string;
  translation_group: string | null;
  cover_media_id: string | null;
  metadata_json: string;
  published_at: string | null;
  archived_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TagRow {
  content_id: string;
  name: string;
}

export interface ListContentQuery {
  type?: ContentType;
  status?: ContentStatus;
  tag?: string;
  search?: string;
  locale?: string;
  page?: number;
  limit?: number;
}

const CONTENT_COLUMNS = `
  c.id, c.type, c.status, c.title, c.slug, c.summary, c.body_markdown,
  c.locale, c.translation_group, c.cover_media_id, c.metadata_json,
  c.published_at, c.archived_at, c.created_at, c.updated_at
`;

function mapContent(row: ContentRow, tags: string[] = []): ContentRecord {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    title: row.title,
    slug: row.slug,
    summary: row.summary,
    bodyMarkdown: row.body_markdown,
    locale: row.locale,
    translationGroup: row.translation_group,
    coverMediaId: row.cover_media_id,
    metadata: parseJsonObject(row.metadata_json),
    tags,
    media: [],
    publishedAt: row.published_at,
    archivedAt: row.archived_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

async function attachTags(db: D1DatabaseLike, rows: ContentRow[]): Promise<ContentRecord[]> {
  if (rows.length === 0) return [];
  const placeholders = rows.map(() => "?").join(", ");
  const tagResult = await db
    .prepare(`
      SELECT ct.content_id, t.name
      FROM content_tags ct
      JOIN tags t ON t.id = ct.tag_id
      WHERE ct.content_id IN (${placeholders})
      ORDER BY t.name COLLATE NOCASE
    `)
    .bind(...rows.map((row) => row.id))
    .all<TagRow>();
  const byContent = new Map<string, string[]>();
  for (const tag of tagResult.results ?? []) {
    const values = byContent.get(tag.content_id) ?? [];
    values.push(tag.name);
    byContent.set(tag.content_id, values);
  }
  const content = rows.map((row) => mapContent(row, byContent.get(row.id) ?? []));
  const mediaResult = await db.prepare(`
    SELECT cm.content_id, cm.media_id, cm.role, cm.sort_order, cm.caption,
      m.file_name, m.mime_type, m.media_kind, m.byte_size, m.width, m.height,
      m.alt_text, m.metadata_json
    FROM content_media cm
    JOIN media m ON m.id = cm.media_id
    WHERE cm.content_id IN (${placeholders})
    ORDER BY cm.content_id, cm.role, cm.sort_order, cm.media_id
  `).bind(...rows.map((row) => row.id)).all<{
    content_id: string;
    media_id: string;
    role: ContentMediaItem["role"];
    sort_order: number;
    caption: string;
    file_name: string;
    mime_type: string;
    media_kind: ContentMediaItem["mediaKind"];
    byte_size: number;
    width: number | null;
    height: number | null;
    alt_text: string;
    metadata_json: string;
  }>();
  const mediaByContent = new Map<string, ContentMediaItem[]>();
  for (const row of mediaResult.results ?? []) {
    const items = mediaByContent.get(row.content_id) ?? [];
    items.push({
      mediaId: row.media_id,
      role: row.role,
      sortOrder: Number(row.sort_order),
      caption: row.caption,
      fileName: row.file_name,
      mimeType: row.mime_type,
      mediaKind: row.media_kind,
      byteSize: Number(row.byte_size),
      width: row.width == null ? null : Number(row.width),
      height: row.height == null ? null : Number(row.height),
      altText: row.alt_text,
      metadata: parseJsonObject(row.metadata_json),
      url: `/media/${encodeURIComponent(row.media_id)}`
    });
    mediaByContent.set(row.content_id, items);
  }
  return content.map((item) => ({ ...item, media: mediaByContent.get(item.id) ?? [] }));
}

export async function listContent(
  db: D1DatabaseLike,
  query: ListContentQuery = {}
): Promise<PaginatedResult<ContentRecord>> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.max(1, Math.min(100, query.limit ?? 20));
  const where: string[] = [];
  const values: unknown[] = [];

  if (query.type) {
    where.push("c.type = ?");
    values.push(query.type);
  }
  if (query.status) {
    where.push("c.status = ?");
    values.push(query.status);
  }
  if (query.locale) {
    where.push("c.locale = ?");
    values.push(query.locale);
  }
  if (query.search?.trim()) {
    const search = `%${query.search.trim().slice(0, 100)}%`;
    where.push("(c.title LIKE ? OR c.summary LIKE ? OR c.body_markdown LIKE ?)");
    values.push(search, search, search);
  }
  if (query.tag?.trim()) {
    where.push(`EXISTS (
      SELECT 1 FROM content_tags filter_ct
      JOIN tags filter_t ON filter_t.id = filter_ct.tag_id
      WHERE filter_ct.content_id = c.id AND filter_t.slug = ?
    )`);
    values.push(normalizeTagSlug(query.tag.trim()));
  }

  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const countRow = await db
    .prepare(`SELECT COUNT(*) AS total FROM content c ${clause}`)
    .bind(...values)
    .first<{ total: number }>();
  const total = Number(countRow?.total ?? 0);
  const rows = await db
    .prepare(`
      SELECT ${CONTENT_COLUMNS}
      FROM content c
      ${clause}
      ORDER BY
        CASE WHEN c.status = 'published' THEN 0 ELSE 1 END,
        COALESCE(c.published_at, c.updated_at) DESC,
        c.id DESC
      LIMIT ? OFFSET ?
    `)
    .bind(...values, limit, (page - 1) * limit)
    .all<ContentRow>();

  return {
    items: await attachTags(db, rows.results ?? []),
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit)
  };
}

export function listPublishedContent(
  db: D1DatabaseLike,
  query: Omit<ListContentQuery, "status"> = {}
): Promise<PaginatedResult<ContentRecord>> {
  return listContent(db, { ...query, status: "published" });
}

export async function getContentById(db: D1DatabaseLike, id: string): Promise<ContentRecord | null> {
  const row = await db
    .prepare(`SELECT ${CONTENT_COLUMNS} FROM content c WHERE c.id = ?`)
    .bind(id)
    .first<ContentRow>();
  return row ? (await attachTags(db, [row]))[0] : null;
}

export async function requireContentById(db: D1DatabaseLike, id: string): Promise<ContentRecord> {
  const content = await getContentById(db, id);
  if (!content) throw new AppError(404, "content_not_found", "找不到指定内容。" );
  return content;
}

export async function getPublishedContentBySlug(
  db: D1DatabaseLike,
  type: ContentType,
  slug: string
): Promise<ContentRecord | null> {
  const row = await db
    .prepare(`SELECT ${CONTENT_COLUMNS} FROM content c WHERE c.type = ? AND c.slug = ? AND c.status = 'published'`)
    .bind(type, slug)
    .first<ContentRow>();
  return row ? (await attachTags(db, [row]))[0] : null;
}

export async function findSlugRedirect(
  db: D1DatabaseLike,
  type: ContentType,
  oldSlug: string
): Promise<{ contentId: string; type: ContentType; slug: string } | null> {
  const row = await db
    .prepare(`
      SELECT r.content_id, c.type, c.slug
      FROM slug_redirects r
      JOIN content c ON c.id = r.content_id
      WHERE r.type = ? AND r.old_slug = ? AND c.status = 'published'
    `)
    .bind(type, oldSlug)
    .first<{ content_id: string; type: ContentType; slug: string }>();
  return row ? { contentId: row.content_id, type: row.type, slug: row.slug } : null;
}

function contentInsertStatement(
  db: D1DatabaseLike,
  id: string,
  input: ContentWriteInput,
  now: string
): D1PreparedStatementLike {
  return db.prepare(`
    INSERT INTO content (
      id, type, status, title, slug, summary, body_markdown, locale,
      translation_group, cover_media_id, metadata_json, published_at,
      archived_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).bind(
    id,
    input.type,
    input.status,
    input.title,
    input.slug,
    input.summary,
    input.bodyMarkdown,
    input.locale,
    input.translationGroup,
    input.coverMediaId,
    JSON.stringify(input.metadata),
    input.publishedAt,
    input.status === "archived" ? now : null,
    now,
    now
  );
}

function tagStatements(
  db: D1DatabaseLike,
  contentId: string,
  values: string[],
  now: string,
  clear = false
): D1PreparedStatementLike[] {
  const statements: D1PreparedStatementLike[] = [];
  if (clear) statements.push(db.prepare("DELETE FROM content_tags WHERE content_id = ?").bind(contentId));
  for (const name of values) {
    const slug = normalizeTagSlug(name);
    const tagId = crypto.randomUUID();
    statements.push(
      db.prepare("INSERT OR IGNORE INTO tags(id, name, slug, created_at) VALUES (?, ?, ?, ?)")
        .bind(tagId, name, slug, now),
      db.prepare(`
        INSERT OR IGNORE INTO content_tags(content_id, tag_id)
        SELECT ?, id FROM tags WHERE slug = ?
      `).bind(contentId, slug)
    );
  }
  return statements;
}

export async function createContent(
  db: D1DatabaseLike,
  input: ContentWriteInput,
  source = "studio"
): Promise<ContentRecord> {
  const id = crypto.randomUUID();
  const revisionId = crypto.randomUUID();
  const now = new Date().toISOString();
  const snapshot = { id, ...input, createdAt: now, updatedAt: now };
  await db.batch([
    contentInsertStatement(db, id, input, now),
    ...tagStatements(db, id, input.tags, now),
    db.prepare(`
      INSERT INTO revisions(id, content_id, revision_number, source, snapshot_json, created_at)
      VALUES (?, ?, 1, ?, ?, ?)
    `).bind(revisionId, id, source, JSON.stringify(snapshot), now)
  ]);
  return requireContentById(db, id);
}

export async function updateContent(
  db: D1DatabaseLike,
  id: string,
  input: ContentWriteInput,
  source = "studio"
): Promise<ContentRecord> {
  const current = await requireContentById(db, id);
  const now = new Date().toISOString();
  const statements: D1PreparedStatementLike[] = [];

  if (current.type !== input.type || current.slug !== input.slug) {
    statements.push(
      db.prepare(`
        INSERT OR IGNORE INTO slug_redirects(id, content_id, type, old_slug, created_at)
        VALUES (?, ?, ?, ?, ?)
      `).bind(crypto.randomUUID(), id, current.type, current.slug, now)
    );
  }

  statements.push(
    db.prepare(`
      UPDATE content SET
        type = ?, status = ?, title = ?, slug = ?, summary = ?, body_markdown = ?,
        locale = ?, translation_group = ?, cover_media_id = ?, metadata_json = ?,
        published_at = ?, archived_at = ?, updated_at = ?
      WHERE id = ?
    `).bind(
      input.type,
      input.status,
      input.title,
      input.slug,
      input.summary,
      input.bodyMarkdown,
      input.locale,
      input.translationGroup,
      input.coverMediaId,
      JSON.stringify(input.metadata),
      input.publishedAt,
      input.status === "archived" ? current.archivedAt ?? now : null,
      now,
      id
    ),
    ...tagStatements(db, id, input.tags, now, true),
    db.prepare(`
      INSERT INTO revisions(id, content_id, revision_number, source, snapshot_json, created_at)
      SELECT ?, ?, COALESCE(MAX(revision_number), 0) + 1, ?, ?, ?
      FROM revisions WHERE content_id = ?
    `).bind(
      crypto.randomUUID(),
      id,
      source,
      JSON.stringify({ ...input, id, createdAt: current.createdAt, updatedAt: now }),
      now,
      id
    )
  );

  await db.batch(statements);
  return requireContentById(db, id);
}

export async function deleteContent(db: D1DatabaseLike, id: string): Promise<void> {
  await requireContentById(db, id);
  await db.batch([
    db.prepare("DELETE FROM content WHERE id = ?").bind(id),
    db.prepare(`
      DELETE FROM tags
      WHERE NOT EXISTS (
        SELECT 1 FROM content_tags WHERE content_tags.tag_id = tags.id
      )
    `)
  ]);
}

export async function assertPublishable(db: D1DatabaseLike, content: ContentRecord): Promise<void> {
  const missing: string[] = [];
  if (!content.title.trim()) missing.push("title");
  if (!content.slug.trim()) missing.push("slug");
  if (!content.summary.trim()) missing.push("summary");
  if ((content.type === "article" || content.type === "game") && !content.bodyMarkdown.trim()) {
    missing.push("bodyMarkdown");
  }
  if ((content.type === "artwork" || content.type === "photo") && !content.coverMediaId) {
    missing.push("coverMediaId");
  }
  if (content.coverMediaId) {
    const cover = await db.prepare("SELECT alt_text FROM media WHERE id = ?")
      .bind(content.coverMediaId)
      .first<{ alt_text: string }>();
    if (!cover) missing.push("coverMediaId");
    else if (!cover.alt_text.trim()) missing.push("coverAltText");
  }
  if (missing.length) {
    throw new AppError(422, "content_not_publishable", "内容缺少发布所需信息。", { missing });
  }
}

export async function replaceContentMedia(
  db: D1DatabaseLike,
  contentId: string,
  media: Array<{
    mediaId: string;
    role?: ContentMediaItem["role"];
    sortOrder?: number;
    caption?: string;
  }>
): Promise<ContentRecord> {
  await requireContentById(db, contentId);
  if (!Array.isArray(media) || media.length > 200) {
    throw new AppError(422, "validation_error", "媒体关系必须是至多 200 项的数组。" );
  }
  const roles = new Set<ContentMediaItem["role"]>(["cover", "inline", "gallery", "attachment"]);
  const seen = new Set<string>();
  const statements: D1PreparedStatementLike[] = [
    db.prepare("DELETE FROM content_media WHERE content_id = ?").bind(contentId)
  ];
  for (let index = 0; index < media.length; index += 1) {
    const item = media[index];
    if (!item || typeof item.mediaId !== "string" || !item.mediaId) {
      throw new AppError(422, "validation_error", `第 ${index + 1} 项缺少 mediaId。`);
    }
    const role = item.role ?? "gallery";
    if (!roles.has(role)) throw new AppError(422, "validation_error", `第 ${index + 1} 项 role 无效。`);
    const uniqueKey = `${item.mediaId}:${role}`;
    if (seen.has(uniqueKey)) continue;
    seen.add(uniqueKey);
    const sortOrder = Number.isSafeInteger(item.sortOrder) ? Number(item.sortOrder) : index;
    const caption = typeof item.caption === "string" ? item.caption.trim().slice(0, 500) : "";
    statements.push(db.prepare(`
      INSERT INTO content_media(content_id, media_id, role, sort_order, caption)
      VALUES (?, ?, ?, ?, ?)
    `).bind(contentId, item.mediaId, role, sortOrder, caption));
  }
  await db.batch(statements);
  return requireContentById(db, contentId);
}

export async function listRevisions(db: D1DatabaseLike, contentId: string, limit = 30): Promise<Array<{
  id: string;
  revisionNumber: number;
  source: string;
  snapshot: unknown;
  createdAt: string;
}>> {
  await requireContentById(db, contentId);
  const result = await db.prepare(`
    SELECT id, revision_number, source, snapshot_json, created_at
    FROM revisions WHERE content_id = ?
    ORDER BY revision_number DESC LIMIT ?
  `).bind(contentId, Math.max(1, Math.min(100, limit))).all<{
    id: string;
    revision_number: number;
    source: string;
    snapshot_json: string;
    created_at: string;
  }>();
  return (result.results ?? []).map((row) => {
    let snapshot: unknown = {};
    try { snapshot = JSON.parse(row.snapshot_json); } catch { /* preserve empty snapshot */ }
    return {
      id: row.id,
      revisionNumber: row.revision_number,
      source: row.source,
      snapshot,
      createdAt: row.created_at
    };
  });
}
