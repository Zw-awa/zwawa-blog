import type { APIRoute } from "astro";
import { listPublishedContent } from "../../../../lib/server/content-repository";
import { getDb } from "../../../../lib/server/env";
import { apiHandler, getPagination, ok } from "../../../../lib/server/http";
import { markdownToHtml } from "../../../../lib/server/markdown";
import { CONTENT_TYPES, type ContentType } from "../../../../lib/server/types";

export const prerender = false;

export const GET: APIRoute = apiHandler(async ({ request, locals }) => {
  const url = new URL(request.url);
  const typeParam = url.searchParams.get("type");
  const type = typeParam && CONTENT_TYPES.includes(typeParam as ContentType) ? typeParam as ContentType : undefined;
  const pagination = getPagination(url);
  const result = await listPublishedContent(getDb(locals), {
    type,
    tag: url.searchParams.get("tag") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    locale: url.searchParams.get("locale") ?? undefined,
    ...pagination
  });
  const response = ok({
    ...result,
    items: result.items.map((item) => ({
      ...item,
      renderedHtml: markdownToHtml(item.bodyMarkdown),
      coverUrl: item.coverMediaId ? `/media/${encodeURIComponent(item.coverMediaId)}` : null
    }))
  });
  response.headers.set("cache-control", "public, max-age=60, s-maxage=300, stale-while-revalidate=600");
  return response;
});
