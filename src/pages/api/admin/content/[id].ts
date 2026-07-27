import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../lib/server/auth";
import { deleteContent, requireContentById, updateContent } from "../../../../lib/server/content-repository";
import { getDb } from "../../../../lib/server/env";
import { AppError } from "../../../../lib/server/errors";
import { apiHandler, noContent, ok, readJson } from "../../../../lib/server/http";
import { validateContentPatch } from "../../../../lib/server/validation";

export const prerender = false;

function getId(value: string | undefined): string {
  if (!value) throw new AppError(404, "content_not_found", "找不到指定内容。" );
  return value;
}

export const GET: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  return ok(await requireContentById(getDb(context.locals), getId(context.params.id)));
});

export const PATCH: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const db = getDb(context.locals);
  const id = getId(context.params.id);
  const current = await requireContentById(db, id);
  const input = validateContentPatch(await readJson(context.request, 2_200_000), current);
  return ok(await updateContent(db, id, input));
});

export const PUT = PATCH;

export const DELETE: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  await deleteContent(getDb(context.locals), getId(context.params.id));
  return noContent();
});
