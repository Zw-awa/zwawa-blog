import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../lib/server/auth";
import { getDb, getMediaBucket } from "../../../../lib/server/env";
import { AppError } from "../../../../lib/server/errors";
import { apiHandler, getPagination, ok } from "../../../../lib/server/http";
import { listMedia, storeMedia } from "../../../../lib/server/media-repository";
import type { MediaRecord } from "../../../../lib/server/types";

export const prerender = false;

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const BLOCKED_TYPES = new Set(["text/html", "application/xhtml+xml", "image/svg+xml"]);
const KINDS = new Set<MediaRecord["mediaKind"]>(["image", "video", "audio", "document", "other"]);

export const GET: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const url = new URL(context.request.url);
  const requestedKind = url.searchParams.get("kind") as MediaRecord["mediaKind"] | null;
  const result = await listMedia(getDb(context.locals), {
    kind: requestedKind && KINDS.has(requestedKind) ? requestedKind : undefined,
    search: url.searchParams.get("search") ?? undefined,
    ...getPagination(url, 40)
  });
  return ok({
    ...result,
    items: result.items.map((media) => ({ ...media, url: `/media/${encodeURIComponent(media.id)}` }))
  });
});

export const POST: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const contentType = context.request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().includes("multipart/form-data")) {
    throw new AppError(415, "unsupported_media_type", "媒体上传必须使用 multipart/form-data。" );
  }
  const form = await context.request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) throw new AppError(422, "validation_error", "缺少 file 文件字段。" );
  if (file.size <= 0) throw new AppError(422, "validation_error", "不能上传空文件。" );
  if (file.size > MAX_UPLOAD_BYTES) throw new AppError(413, "payload_too_large", "单个文件不能超过 25 MB。" );
  const mimeType = file.type || "application/octet-stream";
  if (BLOCKED_TYPES.has(mimeType.toLowerCase())) {
    throw new AppError(415, "unsafe_media_type", "不接受可执行 HTML 或 SVG 文件。请转换为 WebP、PNG 或 JPEG。" );
  }
  const numberField = (name: string): number | null => {
    const raw = form.get(name);
    if (typeof raw !== "string" || !raw) return null;
    const value = Number.parseInt(raw, 10);
    return Number.isSafeInteger(value) && value > 0 ? value : null;
  };
  const media = await storeMedia(getDb(context.locals), getMediaBucket(context.locals), {
    fileName: file.name,
    mimeType,
    byteSize: file.size,
    body: await file.arrayBuffer(),
    altText: typeof form.get("altText") === "string" ? String(form.get("altText")) : "",
    width: numberField("width"),
    height: numberField("height")
  });
  return ok({ ...media, url: `/media/${encodeURIComponent(media.id)}` }, undefined, {
    status: 201,
    headers: { location: `/media/${encodeURIComponent(media.id)}` }
  });
});
