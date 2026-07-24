import type { APIRoute } from "astro";
import { getDb, getMediaBucket } from "../../lib/server/env";
import { AppError } from "../../lib/server/errors";
import { apiHandler } from "../../lib/server/http";
import { requireMediaById } from "../../lib/server/media-repository";

export const prerender = false;

export const GET: APIRoute = apiHandler(async ({ params, locals, request }) => {
  if (!params.id) throw new AppError(404, "media_not_found", "找不到指定媒体。" );
  const media = await requireMediaById(getDb(locals), params.id);
  const object = await getMediaBucket(locals).get(media.objectKey);
  if (!object) throw new AppError(404, "media_object_not_found", "媒体记录存在，但 R2 文件不存在。" );
  const etag = object.httpEtag ?? object.etag;
  if (etag && request.headers.get("if-none-match") === etag) return new Response(null, { status: 304 });
  const headers = new Headers({
    "content-type": media.mimeType,
    "content-length": String(object.size),
    "cache-control": "public, max-age=31536000, immutable",
    "x-content-type-options": "nosniff"
  });
  if (etag) headers.set("etag", etag);
  const canDisplay = /^(image|audio|video)\//.test(media.mimeType) || media.mimeType === "application/pdf";
  headers.set(
    "content-disposition",
    `${canDisplay ? "inline" : "attachment"}; filename*=UTF-8''${encodeURIComponent(media.fileName)}`
  );
  return new Response(object.body as BodyInit, { headers });
});
