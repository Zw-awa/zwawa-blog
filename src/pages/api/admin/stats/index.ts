import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../lib/server/auth";
import { getDb, getRuntimeEnv } from "../../../../lib/server/env";
import { apiHandler, ok } from "../../../../lib/server/http";
import { getStatsDashboard, refreshStatistics } from "../../../../lib/server/stats-repository";

export const prerender = false;

export const GET: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  return ok(await getStatsDashboard(getDb(context.locals)));
});

export const POST: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  const db = getDb(context.locals);
  await refreshStatistics(db, getRuntimeEnv(context.locals));
  return ok(await getStatsDashboard(db));
});
