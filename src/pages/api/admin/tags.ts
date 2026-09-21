import type { APIRoute } from "astro";
import { requireAdmin } from "../../../lib/server/auth";
import { listTags } from "../../../lib/server/content-repository";
import { getDb } from "../../../lib/server/env";
import { apiHandler, ok } from "../../../lib/server/http";

export const prerender = false;
export const GET: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  return ok(await listTags(getDb(context.locals)));
});
