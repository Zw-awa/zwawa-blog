import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../lib/server/auth";
import { getDb, getMediaBucket } from "../../../../lib/server/env";
import { AppError } from "../../../../lib/server/errors";
import { apiHandler, noContent } from "../../../../lib/server/http";
import { deleteMedia } from "../../../../lib/server/media-repository";

export const prerender = false;

export const DELETE: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const id = context.params.id;
  if (!id) throw new AppError(404, "media_not_found", "找不到指定媒体。" );
  await deleteMedia(getDb(context.locals), getMediaBucket(context.locals), id);
  return noContent();
});
