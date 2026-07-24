import type { APIRoute } from "astro";
import { requireAdmin } from "../../../../lib/server/auth";
import { getDb } from "../../../../lib/server/env";
import { AppError } from "../../../../lib/server/errors";
import { apiHandler, ok, readJson } from "../../../../lib/server/http";
import {
  listPlatforms,
  replacePlatforms,
  savePlatform,
  type ExternalPlatform
} from "../../../../lib/server/stats-repository";

export const prerender = false;

export const GET: APIRoute = apiHandler(async (context) => {
  requireAdmin(context);
  return ok(await listPlatforms(getDb(context.locals)));
});

async function readPlatforms(context: Parameters<APIRoute>[0]): Promise<Partial<ExternalPlatform>[]> {
  requireAdmin(context);
  const payload = await readJson<
    { platforms?: Partial<ExternalPlatform>[] } | Partial<ExternalPlatform> | Partial<ExternalPlatform>[]
  >(
    context.request,
    250_000
  );
  let values: Partial<ExternalPlatform>[];
  if (Array.isArray(payload)) {
    values = payload;
  } else if ("platforms" in payload && Array.isArray(payload.platforms)) {
    values = payload.platforms;
  } else {
    values = [payload as Partial<ExternalPlatform>];
  }
  if (values.length > 50) throw new AppError(422, "validation_error", "一次最多保存 50 个平台。" );
  return values;
}

export const PUT: APIRoute = apiHandler(async (context) => {
  const values = await readPlatforms(context);
  return ok(await replacePlatforms(getDb(context.locals), values));
});

export const POST: APIRoute = apiHandler(async (context) => {
  const values = await readPlatforms(context);
  const saved = [];
  for (const value of values) saved.push(await savePlatform(getDb(context.locals), value));
  return ok(saved, undefined, { status: 201 });
});
