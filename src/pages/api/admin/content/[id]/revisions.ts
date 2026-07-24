import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../../lib/server/auth";
import { listRevisions } from "../../../../../lib/server/content-repository";
import { getDb } from "../../../../../lib/server/env";
import { AppError } from "../../../../../lib/server/errors";
import { apiHandler, ok } from "../../../../../lib/server/http";

export const prerender = false;

export const GET: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const id = context.params.id;
  if (!id) throw new AppError(404, "content_not_found", "找不到指定内容。" );
  const limit = Number.parseInt(new URL(context.request.url).searchParams.get("limit") ?? "30", 10);
  return ok(await listRevisions(getDb(context.locals), id, limit));
});
