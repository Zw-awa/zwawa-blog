import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../../lib/server/auth";
import { replaceContentMedia, requireContentById } from "../../../../../lib/server/content-repository";
import { getDb } from "../../../../../lib/server/env";
import { AppError } from "../../../../../lib/server/errors";
import { apiHandler, ok, readJson } from "../../../../../lib/server/http";
import type { ContentMediaItem } from "../../../../../lib/server/types";

export const prerender = false;

function requireId(value: string | undefined): string {
  if (!value) throw new AppError(404, "content_not_found", "找不到指定内容。" );
  return value;
}

export const GET: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const content = await requireContentById(getDb(context.locals), requireId(context.params.id));
  return ok(content.media);
});

export const PUT: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const payload = await readJson<{
    media?: Array<{
      mediaId: string;
      role?: ContentMediaItem["role"];
      sortOrder?: number;
      caption?: string;
    }>;
  }>(context.request, 250_000);
  if (!Array.isArray(payload.media)) throw new AppError(422, "validation_error", "media 必须是数组。" );
  return ok(await replaceContentMedia(getDb(context.locals), requireId(context.params.id), payload.media));
});
