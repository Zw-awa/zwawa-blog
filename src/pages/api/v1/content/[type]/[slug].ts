import type { APIRoute } from "astro";
import { findSlugRedirect, getPublishedContentBySlug } from "../../../../../lib/server/content-repository";
import { getDb } from "../../../../../lib/server/env";
import { AppError } from "../../../../../lib/server/errors";
import { apiHandler, ok } from "../../../../../lib/server/http";
import { markdownToHtml } from "../../../../../lib/server/markdown";
import { CONTENT_TYPES, type ContentType } from "../../../../../lib/server/types";

export const prerender = false;

export const GET: APIRoute = apiHandler(async ({ params, locals, request }) => {
  const type = params.type;
  const slug = params.slug;
  if (!type || !CONTENT_TYPES.includes(type as ContentType) || !slug) {
    throw new AppError(404, "content_not_found", "找不到指定内容。" );
  }
  const db = getDb(locals);
  const content = await getPublishedContentBySlug(db, type as ContentType, slug);
  if (!content) {
    const redirect = await findSlugRedirect(db, type as ContentType, slug);
    if (redirect) {
      return Response.redirect(
        new URL(`/api/v1/content/${redirect.type}/${encodeURIComponent(redirect.slug)}`, request.url),
        308
      );
    }
    throw new AppError(404, "content_not_found", "找不到指定内容。" );
  }
  const response = ok({
    ...content,
    renderedHtml: markdownToHtml(content.bodyMarkdown),
    coverUrl: content.coverMediaId ? `/media/${encodeURIComponent(content.coverMediaId)}` : null
  });
  response.headers.set("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  return response;
});
