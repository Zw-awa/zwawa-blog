import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../lib/server/auth";
import { revokeCredential } from "../../../../lib/server/credentials-repository";
import { getDb } from "../../../../lib/server/env";
import { AppError } from "../../../../lib/server/errors";
import { apiHandler, noContent } from "../../../../lib/server/http";

export const prerender = false;

export const DELETE: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  if (!context.params.id) throw new AppError(404, "credential_not_found", "找不到应用密码。" );
  await revokeCredential(getDb(context.locals), context.params.id);
  return noContent();
});
