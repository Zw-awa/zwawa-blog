import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../../lib/server/auth";
import { requireContentById } from "../../../../../lib/server/content-repository";
import { getDb } from "../../../../../lib/server/env";
import { AppError } from "../../../../../lib/server/errors";
import { apiHandler } from "../../../../../lib/server/http";
import { serializeFrontmatter } from "../../../../../lib/server/markdown";

export const prerender = false;

export const GET: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const id = context.params.id;
  if (!id) throw new AppError(404, "content_not_found", "找不到指定内容。" );
  const content = await requireContentById(getDb(context.locals), id);
  const markdown = serializeFrontmatter({
    id: content.id,
    title: content.title,
    slug: content.slug,
    type: content.type,
    summary: content.summary,
    tags: content.tags,
    cover: content.coverMediaId ? `/media/${content.coverMediaId}` : "",
    locale: content.locale,
    publishedAt: content.publishedAt
  }, content.bodyMarkdown);
  return new Response(markdown, {
    headers: {
      "content-type": "text/markdown; charset=utf-8",
      "content-disposition": `attachment; filename*=UTF-8''${encodeURIComponent(`${content.slug}.md`)}`,
      "x-content-type-options": "nosniff"
    }
  });
});
