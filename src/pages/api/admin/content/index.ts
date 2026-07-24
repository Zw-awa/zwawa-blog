import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../lib/server/auth";
import { createContent, listContent } from "../../../../lib/server/content-repository";
import { getDb } from "../../../../lib/server/env";
import { apiHandler, getPagination, ok, readJson } from "../../../../lib/server/http";
import { CONTENT_STATUSES, CONTENT_TYPES, type ContentStatus, type ContentType } from "../../../../lib/server/types";
import { validateContentCreate } from "../../../../lib/server/validation";

export const prerender = false;

export const GET: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const url = new URL(context.request.url);
  const typeParam = url.searchParams.get("type");
  const statusParam = url.searchParams.get("status");
  const type = typeParam && CONTENT_TYPES.includes(typeParam as ContentType) ? typeParam as ContentType : undefined;
  const status = statusParam && CONTENT_STATUSES.includes(statusParam as ContentStatus) ? statusParam as ContentStatus : undefined;
  const result = await listContent(getDb(context.locals), {
    type,
    status,
    tag: url.searchParams.get("tag") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    locale: url.searchParams.get("locale") ?? undefined,
    ...getPagination(url)
  });
  return ok(result);
});

export const POST: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const input = validateContentCreate(await readJson(context.request, 2_200_000));
  const content = await createContent(getDb(context.locals), input);
  return ok(content, undefined, {
    status: 201,
    headers: { location: `/api/admin/content/${encodeURIComponent(content.id)}` }
  });
});
