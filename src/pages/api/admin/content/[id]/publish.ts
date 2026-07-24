import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../../lib/server/auth";
import { assertPublishable, requireContentById, updateContent } from "../../../../../lib/server/content-repository";
import { getDb } from "../../../../../lib/server/env";
import { AppError } from "../../../../../lib/server/errors";
import { apiHandler, ok } from "../../../../../lib/server/http";
import { validateContentPatch } from "../../../../../lib/server/validation";

export const prerender = false;

export const POST: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const id = context.params.id;
  if (!id) throw new AppError(404, "content_not_found", "找不到指定内容。" );
  const db = getDb(context.locals);
  const current = await requireContentById(db, id);
  await assertPublishable(db, current);
  const input = validateContentPatch({
    status: "published",
    publishedAt: current.publishedAt ?? new Date().toISOString()
  }, current);
  return ok(await updateContent(db, id, input));
});
