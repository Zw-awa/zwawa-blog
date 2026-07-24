import { AppError } from "./errors";
import type { D1DatabaseLike, JsonObject, MediaRecord, R2BucketLike } from "./types";
import { parseJsonObject } from "./validation";

interface MediaRow {
  id: string;
  object_key: string;
  file_name: string;
  mime_type: string;
  media_kind: MediaRecord["mediaKind"];
  byte_size: number;
  width: number | null;
  height: number | null;
  alt_text: string;
  metadata_json: string;
  created_at: string;
  updated_at: string;
}

export interface MediaListQuery {
  kind?: MediaRecord["mediaKind"];
  search?: string;
  page?: number;
  limit?: number;
}

function mapMedia(row: MediaRow): MediaRecord {
  return {
    id: row.id,
    objectKey: row.object_key,
    fileName: row.file_name,
    mimeType: row.mime_type,
    mediaKind: row.media_kind,
    byteSize: Number(row.byte_size),
    width: row.width == null ? null : Number(row.width),
    height: row.height == null ? null : Number(row.height),
    altText: row.alt_text,
    metadata: parseJsonObject(row.metadata_json),
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

function inferKind(mimeType: string): MediaRecord["mediaKind"] {
  if (mimeType.startsWith("image/")) return "image";
  if (mimeType.startsWith("video/")) return "video";
  if (mimeType.startsWith("audio/")) return "audio";
  if (mimeType.includes("pdf") || mimeType.includes("document") || mimeType.includes("text/")) return "document";
  return "other";
}

export async function listMedia(db: D1DatabaseLike, query: MediaListQuery = {}) {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.max(1, Math.min(100, query.limit ?? 40));
  const where: string[] = [];
  const values: unknown[] = [];
  if (query.kind) {
    where.push("media_kind = ?");
    values.push(query.kind);
  }
  if (query.search?.trim()) {
    where.push("(file_name LIKE ? OR alt_text LIKE ?)");
    const search = `%${query.search.trim().slice(0, 100)}%`;
    values.push(search, search);
  }
  const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
  const count = await db.prepare(`SELECT COUNT(*) AS total FROM media ${clause}`).bind(...values).first<{ total: number }>();
  const total = Number(count?.total ?? 0);
  const rows = await db.prepare(`
    SELECT id, object_key, file_name, mime_type, media_kind, byte_size, width, height,
      alt_text, metadata_json, created_at, updated_at
    FROM media ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?
  `).bind(...values, limit, (page - 1) * limit).all<MediaRow>();
  return {
    items: (rows.results ?? []).map(mapMedia),
    page,
    limit,
    total,
    totalPages: total === 0 ? 0 : Math.ceil(total / limit)
  };
}

export async function getMediaById(db: D1DatabaseLike, id: string): Promise<MediaRecord | null> {
  const row = await db.prepare(`
    SELECT id, object_key, file_name, mime_type, media_kind, byte_size, width, height,
      alt_text, metadata_json, created_at, updated_at
    FROM media WHERE id = ?
  `).bind(id).first<MediaRow>();
  return row ? mapMedia(row) : null;
}

export async function requireMediaById(db: D1DatabaseLike, id: string): Promise<MediaRecord> {
  const media = await getMediaById(db, id);
  if (!media) throw new AppError(404, "media_not_found", "找不到指定媒体。" );
  return media;
}

export interface StoreMediaInput {
  id?: string;
  fileName: string;
  mimeType: string;
  byteSize: number;
  body: ArrayBuffer | ArrayBufferView | Blob | ReadableStream | string;
  altText?: string;
  width?: number | null;
  height?: number | null;
  metadata?: JsonObject;
}

export async function storeMedia(
  db: D1DatabaseLike,
  bucket: R2BucketLike,
  input: StoreMediaInput
): Promise<MediaRecord> {
  if (!input.fileName.trim()) throw new AppError(422, "validation_error", "文件名不能为空。" );
  if (!input.mimeType || input.mimeType.length > 160) throw new AppError(422, "validation_error", "媒体类型无效。" );
  if (!Number.isSafeInteger(input.byteSize) || input.byteSize < 0) {
    throw new AppError(422, "validation_error", "文件大小无效。" );
  }
  const id = input.id ?? crypto.randomUUID();
  const safeName = input.fileName
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}._-]+/gu, "-")
    .replace(/-{2,}/g, "-")
    .slice(0, 160) || "upload";
  const now = new Date();
  const isoNow = now.toISOString();
  const prefix = `${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
  const objectKey = `${prefix}/${id}-${safeName}`;
  await bucket.put(objectKey, input.body, {
    httpMetadata: {
      contentType: input.mimeType,
      cacheControl: "public, max-age=31536000, immutable"
    },
    customMetadata: { mediaId: id }
  });
  try {
    await db.prepare(`
      INSERT INTO media(
        id, object_key, file_name, mime_type, media_kind, byte_size, width, height,
        alt_text, metadata_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      id,
      objectKey,
      input.fileName.trim().slice(0, 255),
      input.mimeType,
      inferKind(input.mimeType),
      input.byteSize,
      input.width ?? null,
      input.height ?? null,
      (input.altText ?? "").trim().slice(0, 500),
      JSON.stringify(input.metadata ?? {}),
      isoNow,
      isoNow
    ).run();
  } catch (error) {
    await bucket.delete(objectKey).catch(() => undefined);
    throw error;
  }
  return requireMediaById(db, id);
}

export async function deleteMedia(db: D1DatabaseLike, bucket: R2BucketLike, id: string): Promise<void> {
  const media = await requireMediaById(db, id);
  const usage = await db.prepare(`
    SELECT
      (SELECT COUNT(*) FROM content WHERE cover_media_id = ?) +
      (SELECT COUNT(*) FROM content_media WHERE media_id = ?) AS count
  `).bind(id, id).first<{ count: number }>();
  if (Number(usage?.count ?? 0) > 0) {
    throw new AppError(409, "media_in_use", "媒体仍被内容使用，请先移除引用。" );
  }
  const assetSetting = await db.prepare("SELECT value_json FROM site_settings WHERE key = 'site.assets'")
    .first<{ value_json: string }>();
  if (assetSetting) {
    try {
      const assets = JSON.parse(assetSetting.value_json) as Record<string, unknown>;
      if (Object.values(assets).includes(id)) {
        throw new AppError(409, "media_in_use", "媒体仍被站点外观使用，请先在站点设置中移除。" );
      }
    } catch (error) {
      if (error instanceof AppError) throw error;
    }
  }
  await bucket.delete(media.objectKey);
  await db.prepare("DELETE FROM media WHERE id = ?").bind(id).run();
}
